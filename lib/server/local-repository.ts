import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createSeedCatalog } from '@/lib/catalog/seed';
import type { AdminSession, CatalogData, CatalogRecord, CatalogRelease, CatalogRepository, CollectionName, MediaAsset } from '@/lib/catalog/contracts';
import { archiveCatalogRecord, updateCatalogRecord, prepareCatalogRelease, CatalogDomainError, assertRevision } from '@/lib/catalog/service';
import { preflightCatalog, hasValidationErrors } from '@/lib/catalog/validation';
import type { ValidationIssue } from '@/lib/catalog/contracts';
import { inspectMedia } from './media/inspect';
import { getMediaPath } from './media/upload';

/** Local demo adapter. Move provider-specific SQL here; UI/domain stays portable. */
export class LocalCatalogRepository implements CatalogRepository {
  readonly database: DatabaseSync;
  readonly directory: string;
  constructor(directory = process.env.ADMIN_DATA_DIR || resolve(process.cwd(), 'data/admin')) {
    mkdirSync(directory, { recursive: true });
    this.directory=directory;
    this.database = new DatabaseSync(resolve(directory, 'catalog.sqlite'));
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS draft_catalog (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS releases (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, created_by TEXT NOT NULL, note TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publication (id INTEGER PRIMARY KEY CHECK(id = 1), release_id TEXT REFERENCES releases(id));
      CREATE TABLE IF NOT EXISTS admin_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','editor')));
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES admin_users(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS login_attempts (email TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_start INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publish_requests (request_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, release_id TEXT NOT NULL REFERENCES releases(id));
      PRAGMA foreign_keys = ON;
    `);
    if (!this.database.prepare('SELECT id FROM draft_catalog WHERE id=1').get()) {
      const seed = createSeedCatalog();
      for (const media of seed.media) {
        const bytes = readFileSync(resolve(process.cwd(),'public',media.url.slice(1)));
        const inspected = inspectMedia(bytes,media.role);
        media.bytes=bytes.length; media.sha256=createHash('sha256').update(bytes).digest('hex'); media.width=inspected.width; media.height=inspected.height;
      }
      this.database.prepare('INSERT INTO draft_catalog(id,data) VALUES(1,?)').run(JSON.stringify(seed));
    }
    this.database.prepare('INSERT OR IGNORE INTO publication(id,release_id) VALUES(1,NULL)').run();
  }
  close() { this.database.close(); }
  private atomic<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try { const value = operation(); this.database.exec('COMMIT'); return value; }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  async readDraft(): Promise<CatalogData> { const row = this.database.prepare('SELECT data FROM draft_catalog WHERE id=1').get() as { data: string }; return JSON.parse(row.data); }
  private draftSync(): CatalogData { return JSON.parse((this.database.prepare('SELECT data FROM draft_catalog WHERE id=1').get() as { data: string }).data); }
  private writeDraft(data: CatalogData) { this.database.prepare('UPDATE draft_catalog SET data=? WHERE id=1').run(JSON.stringify(data)); }
  private audit(actor: string, action: string, entityId: string) { this.database.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)').run(randomUUID(), actor, action, entityId, new Date().toISOString()); }
  async saveRecord(collection: CollectionName, record: CatalogRecord, expectedRevision: number | null, actor = 'admin'): Promise<CatalogRecord> {
    return this.atomic(() => {
      const updated = updateCatalogRecord(this.draftSync(), collection, record, expectedRevision);
      this.writeDraft(updated);
      this.audit(actor, `save:${collection}`, record.id);
      return updated[collection].find(item => item.id === record.id)!;
    });
  }
  async archiveRecord(collection: CollectionName, id: string, expectedRevision: number, actor = 'admin'): Promise<void> {
    this.atomic(() => { this.writeDraft(archiveCatalogRecord(this.draftSync(), collection, id, expectedRevision)); this.audit(actor, `archive:${collection}`, id); });
  }
  async reorder(collection: CollectionName, id: string, direction: 'up' | 'down', expectedRevisions:Record<string,number>, actor = 'admin'): Promise<CatalogData> {
    return this.atomic(() => {
      const data = this.draftSync();
      const current = data[collection].find(item => item.id === id);
      if (!current || current.lifecycle!=='active' || !('position' in current)) throw new CatalogDomainError('invalid_reorder','Chỉ bản ghi đang hoạt động và có thứ tự mới sắp xếp được.');
      const context = (item: CatalogRecord) => ('groupId' in current && 'groupId' in item ? current.groupId === item.groupId : 'categoryId' in current && 'categoryId' in item ? current.categoryId === item.categoryId : collection==='flavorAssets'&&'flavorId' in current&&'flavorId' in item ? current.flavorId===item.flavorId : true);
      const list = data[collection].filter(item => item.lifecycle === 'active' && 'position' in item && context(item)).sort((a,b) => (a as typeof current).position - (b as typeof current).position);
      for(const item of list) assertRevision(item,expectedRevisions[item.id]??null);
      const index = list.findIndex(item => item.id === id), next = index + (direction === 'up' ? -1 : 1);
      if (next < 0 || next >= list.length) return data;
      [list[index], list[next]] = [list[next], list[index]];
      list.forEach((item, position) => { if ('position' in item) { item.position = position; item.revision++; item.updatedAt = new Date().toISOString(); } });
      this.writeDraft(data); this.audit(actor, `reorder:${collection}`, id); return data;
    });
  }
  async listReleases(): Promise<Omit<CatalogRelease,'data'>[]> {
    return this.database.prepare('SELECT id,created_at,created_by,note FROM releases ORDER BY created_at DESC').all().map(row => ({ id: row.id as string, schemaVersion: 1 as const, createdAt: row.created_at as string, createdBy: row.created_by as string, note: row.note as string }));
  }
  private activeId(): string | null { return (this.database.prepare('SELECT release_id FROM publication WHERE id=1').get() as { release_id: string | null }).release_id; }
  private releaseSync(id: string): CatalogRelease | null {
    const row = this.database.prepare('SELECT * FROM releases WHERE id=?').get(id);
    return row ? { id: row.id as string, schemaVersion: 1, createdAt: row.created_at as string, createdBy: row.created_by as string, note: row.note as string, data: JSON.parse(row.data as string) } : null;
  }
  async readActiveRelease(): Promise<CatalogRelease | null> { const id = this.activeId(); return id ? this.releaseSync(id) : null; }
  /** Retained releases keep their immutable media URLs available to already-open pages. */
  async readPublishedMedia(id: string): Promise<MediaAsset | null> {
    for (const row of this.database.prepare('SELECT data FROM releases ORDER BY created_at DESC').all()) {
      const data:CatalogData = JSON.parse(row.data as string);
      const media=data.media.find(item=>item.id===id&&item.status==='ready');
      if(media) return media;
    }
    return null;
  }
  private fileIssues(data:CatalogData):ValidationIssue[] {
    const issues:ValidationIssue[]=[];
    for(const media of data.media) {
      try {
        const filename=media.storageKey?getMediaPath(media.storageKey,this.directory):resolve(process.cwd(),'public',media.url.slice(1));
        if(!media.storageKey&&!media.url.startsWith('/assets/')&&!media.url.startsWith('/models/')) throw new Error('Không hỗ trợ URL file ngoài.');
        const bytes=readFileSync(filename);
        if(bytes.length!==media.bytes||createHash('sha256').update(bytes).digest('hex')!==media.sha256) throw new Error('File thay đổi.');
        if(media.role==='model') {
          const inspected=inspectMedia(bytes,'model').model!;
          const names=new Set([...inspected.materialNames,...inspected.meshNames,...inspected.meshNames.map(name=>name.replace(/\s/g,'_').replace(/[\[\]\.:\/]/g,''))]);
          for(const model of data.models3d.filter(item=>item.mediaId===media.id)) {
            const missing=Object.values(model.materialSlots).flat().filter(name=>!names.has(name));
            if(missing.length)issues.push({code:'material_slot_missing',message:'Model “'+model.name+'” khai báo tên vật liệu/mesh không có trong GLB: '+missing.join(', ')+'. Kiểm tra lại material slots.',collection:'models3d',entityId:model.id,field:'materialSlots',severity:'error'});
          }
        }
      } catch {
        issues.push({code:'asset_unavailable',message:'File “'+media.name+'” không còn tồn tại hoặc checksum đã thay đổi. Upload lại phiên bản mới.',collection:'media',entityId:media.id,field:'storageKey',severity:'error'});
      }
    }
    return issues;
  }
  async preflight():Promise<ValidationIssue[]> {
    const data=this.draftSync(),issues=preflightCatalog(data);
    return hasValidationErrors(issues)?issues:[...issues,...this.fileIssues(prepareCatalogRelease(data))];
  }
  async publish(_data: CatalogData, actor: string, note: string, expectedReleaseId: string | null, options:{expectedDraftHash?:string;requestKey?:string}={}): Promise<CatalogRelease> {
    return this.atomic(() => {
      const requestKey=options.requestKey?actor+':'+options.requestKey:null;
      const fingerprint=createHash('sha256').update(JSON.stringify({note,expectedReleaseId,expectedDraftHash:options.expectedDraftHash||null})).digest('hex');
      if(requestKey) {
        const prior=this.database.prepare('SELECT * FROM publish_requests WHERE request_key=?').get(requestKey);
        if(prior) {if(prior.fingerprint!==fingerprint)throw new CatalogDomainError('idempotency_conflict','Yêu cầu xuất bản đã được dùng cho dữ liệu khác.');return this.releaseSync(prior.release_id as string)!;}
      }
      if (this.activeId() !== expectedReleaseId) throw Object.assign(new Error('Bản đang chạy đã thay đổi. Hãy tải lại trước khi xuất bản.'), { code: 'REVISION_CONFLICT' });
      const draft=this.draftSync();
      if(options.expectedDraftHash&&createHash('sha256').update(JSON.stringify(draft)).digest('hex')!==options.expectedDraftHash)throw new CatalogDomainError('revision_conflict','Bản nháp đã được cập nhật sau khi xem trước. Tải lại và kiểm tra trước khi xuất bản.');
      const data = prepareCatalogRelease(draft);
      const fileIssues=this.fileIssues(data);
      if(fileIssues.length) throw new CatalogDomainError('publish_assets_invalid','Không thể xuất bản do file tài nguyên thiếu hoặc đã thay đổi.',fileIssues);
      const release: CatalogRelease = { id: randomUUID(), schemaVersion: 1, createdAt: new Date().toISOString(), createdBy: actor, note: note.slice(0, 1000), data };
      this.database.prepare('INSERT INTO releases VALUES(?,?,?,?,?)').run(release.id, release.createdAt, actor, release.note, JSON.stringify(data));
      this.database.prepare('UPDATE publication SET release_id=? WHERE id=1').run(release.id);
      if(requestKey)this.database.prepare('INSERT INTO publish_requests VALUES(?,?,?)').run(requestKey,fingerprint,release.id);
      this.audit(actor, 'publish', release.id); return release;
    });
  }
  async rollback(releaseId: string, actor: string, expectedReleaseId: string | null): Promise<void> {
    this.atomic(() => {
      if (this.activeId() !== expectedReleaseId) throw Object.assign(new Error('Bản đang chạy đã thay đổi.'), { code: 'REVISION_CONFLICT' });
      const release=this.releaseSync(releaseId);
      if (!release) throw new Error('Không tìm thấy phiên bản.');
      const fileIssues=this.fileIssues(release.data);
      if(fileIssues.length) throw new CatalogDomainError('rollback_assets_invalid','Không thể khôi phục phiên bản do tài nguyên không còn sẵn sàng.',fileIssues);
      this.database.prepare('UPDATE publication SET release_id=? WHERE id=1').run(releaseId); this.audit(actor, 'rollback', releaseId);
    });
  }
  needsSetup(): boolean { return !this.database.prepare('SELECT id FROM admin_users LIMIT 1').get(); }
  bootstrapOwner(email: string, password: string): AdminSession {
    return this.atomic(() => {
      if (!this.needsSetup()) throw new Error('Tài khoản chủ quản trị đã được thiết lập.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 256) throw new Error('Email hợp lệ và mật khẩu từ 12 đến 256 ký tự là bắt buộc.');
      const id = randomUUID(), salt = randomBytes(16).toString('hex');
      this.database.prepare('INSERT INTO admin_users VALUES(?,?,?,?,?)').run(id, email.toLowerCase(), scryptSync(password,salt,64).toString('hex'), salt, 'owner');
      return { userId: id, email: email.toLowerCase(), role: 'owner' };
    });
  }
  login(email: string, password: string): AdminSession {
    const normalized = email.toLowerCase(), now = Date.now();
    const attempts = this.database.prepare('SELECT * FROM login_attempts WHERE email=?').get(normalized);
    if (attempts && now - Number(attempts.window_start) < 900_000 && Number(attempts.attempts) >= 5) throw Object.assign(new Error('Thử đăng nhập quá nhiều. Hãy thử lại sau 15 phút.'), { code: 'RATE_LIMITED' });
    const row = this.database.prepare('SELECT * FROM admin_users WHERE email=?').get(normalized);
    const hash = scryptSync(password.slice(0,256), row?.salt as string || 'dummy-salt', 64);
    if (!row || !timingSafeEqual(hash,Buffer.from(row.password_hash as string,'hex'))) {
      this.database.prepare('INSERT INTO login_attempts VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET attempts=CASE WHEN ?-window_start>=900000 THEN 1 ELSE attempts+1 END, window_start=CASE WHEN ?-window_start>=900000 THEN ? ELSE window_start END').run(normalized,1,now,now,now,now);
      throw Object.assign(new Error('Email hoặc mật khẩu chưa đúng.'), { code: 'UNAUTHORIZED' });
    }
    this.database.prepare('DELETE FROM login_attempts WHERE email=?').run(normalized);
    return { userId: row.id as string, email: row.email as string, role: row.role as AdminSession['role'] };
  }
  createSession(user: AdminSession): string {
    const token = randomBytes(32).toString('hex');
    this.database.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
    this.database.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),user.userId,Date.now()+28_800_000); return token;
  }
  session(token: string): AdminSession | null {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const row = this.database.prepare('SELECT u.* FROM sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(createHash('sha256').update(token).digest('hex'),Date.now());
    return row ? { userId: row.id as string, email: row.email as string, role: row.role as AdminSession['role'] } : null;
  }
  revokeSession(token: string) { this.database.prepare('DELETE FROM sessions WHERE token_hash=?').run(createHash('sha256').update(token).digest('hex')); }
}
