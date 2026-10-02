/* eslint-disable @typescript-eslint/no-require-imports -- Integration tests run the actual local TypeScript backend. */
require('../register-admin-typescript.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { LocalCatalogRepository } = require('../../lib/server/local-repository.ts');
const { createAdminHandler } = require('../../lib/server/admin-api.ts');
const { newEntity } = require('../../lib/catalog/seed.ts');
const { getMediaPath } = require('../../lib/server/media/upload.ts');
const project = path.resolve(__dirname, '../..');
const allowedOrigin = 'http://localhost:3100';
const owner = { email: 'owner@example.test', password: 'demo-owner-password-2026' };

async function withBackend(callback) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vinut-admin-api-'));
  let repository = new LocalCatalogRepository(folder);
  let handle = createAdminHandler(repository, { allowedOrigins: [allowedOrigin], dataDir: folder });
  let ownerCookie = '';
  const context = {
    folder,
    get repository() { return repository; },
    async request(endpoint, options = {}) {
      const method = options.method || 'GET';
      const headers = new Headers(options.headers);
      const origin = options.origin === undefined ? allowedOrigin : options.origin;
      if (origin !== null) headers.set('Origin', origin);
      const cookie = options.cookie === undefined ? ownerCookie : options.cookie;
      if (cookie) headers.set('Cookie', cookie);
      let body;
      if (options.form) body = options.form;
      else if (options.body !== undefined) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(options.body); }
      const response = await handle(new Request(`http://127.0.0.1:3010${endpoint}`, { method, headers, ...(body === undefined ? {} : { body }) }));
      const payload = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : null;
      return { response, payload };
    },
    async setup() {
      const result = await this.request('/api/admin/v1/setup', { method: 'POST', body: owner, cookie: '' });
      assert.equal(result.response.status, 201, JSON.stringify(result.payload));
      ownerCookie = result.response.headers.get('Set-Cookie').split(';')[0];
      assert.match(result.response.headers.get('Set-Cookie'), /HttpOnly/);
      return ownerCookie;
    },
    async save(collection, record, expectedRevision = null) {
      const result = await this.request('/api/admin/v1/record', { method: 'POST', body: { collection, record, expectedRevision } });
      assert.equal(result.response.status, 200, JSON.stringify(result.payload));
      return result.payload.data;
    },
    async upload(role = 'image-2d', assetName = 'citrus-preview.jpg') {
      const bytes = fs.readFileSync(path.join(project, 'public/assets/flavors', assetName));
      const form = new FormData(); form.set('role', role); form.set('file', new File([bytes], assetName, { type: 'image/jpeg' }));
      const result = await this.request('/api/admin/v1/upload', { method: 'POST', form });
      assert.equal(result.response.status, 201, JSON.stringify(result.payload));
      const media = result.payload.data;
      const runtimeBytes = fs.readFileSync(getMediaPath(media.storageKey, folder));
      assert.equal(runtimeBytes.length, media.bytes);
      assert.equal(createHash('sha256').update(runtimeBytes).digest('hex'), media.sha256);
      return { media, bytes: runtimeBytes, sourceBytes: bytes };
    },
    reopen() {
      repository.close(); repository = new LocalCatalogRepository(folder);
      handle = createAdminHandler(repository, { allowedOrigins: [allowedOrigin], dataDir: folder });
    },
  };
  try { await callback(context); }
  finally {
    repository.close();
    const absolute = path.resolve(folder);
    assert.ok(absolute.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(absolute).startsWith('vinut-admin-api-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  }
}

async function createVisible2DProduct(context) {
  const { media, bytes } = await context.upload();
  let group = await context.save('productGroups', { ...newEntity('API test Juice 30%', 'api-test-group'), drinkTypeId: 'juice', description: '', buttonLabel: 'Juice 30%', position: 0, visible: false });
  const flavor = await context.save('flavors', { ...newEntity('API test citrus', 'api-test-flavor'), shortName: 'Citrus', description: '', accentColor: '#ee9933', backgroundColor: '#886622', textColor: '#ffffff', icon: 'citrus', thumbnailId: null, position: 0 });
  const variant = await context.save('productVariants', { ...newEntity('API citrus 330 ml', 'api-test-variant'), groupId: group.id, packagingVariantId: 'can-330', flavorId: flavor.id, code: 'API330', description: '', enabled: true });
  const asset = await context.save('assets2d', { ...newEntity('API citrus render', 'api-test-asset'), packagingVariantId: 'can-330', drinkTypeId: 'juice', flavorId: flavor.id, mediaId: media.id, galleryIds: [], description: '' });
  const display = await context.save('displays2d', { ...newEntity('API citrus display', 'api-test-display'), productVariantId: variant.id, assetId: asset.id, alt: 'Juice 30% citrus can 330 ml', enabled: true });
  const slot = await context.save('packagingSlots', { ...newEntity('API can slot', 'api-test-slot'), groupId: group.id, packagingVariantId: 'can-330', regionKey: 'packaging-picker', position: 0, buttonLabel: '330 ml', mode: '2d', defaultVariantId: variant.id, enabled: true });
  group = await context.save('productGroups', { ...group, visible: true }, group.revision);
  return { media, bytes, group, flavor, variant, asset, display, slot };
}

test('anonymous requests and untrusted origins cannot read or write the admin catalog', async () => withBackend(async context => {
  const initial = await context.request('/api/admin/v1/session', { cookie: '' });
  assert.equal(initial.payload.data.needsSetup, true); assert.equal(initial.payload.data.session, null);
  assert.equal((await context.request('/api/admin/v1/catalog', { cookie: '' })).response.status, 401);
  assert.equal((await context.request('/api/public/v1/catalog', { cookie: '' })).response.status, 404);
  assert.equal((await context.request('/api/admin/v1/setup', { method: 'POST', body: owner, cookie: '', origin: 'https://untrusted.example' })).response.status, 403);
  assert.equal((await context.request('/api/admin/v1/setup', { method: 'POST', body: owner, cookie: '', origin: null })).response.status, 403);
  const preflight = await context.request('/api/admin/v1/setup', { method: 'OPTIONS', cookie: '' });
  assert.equal(preflight.response.status, 204); assert.equal(preflight.response.headers.get('Access-Control-Allow-Origin'), allowedOrigin);
  await context.setup();
  assert.equal((await context.request('/api/admin/v1/catalog', { origin: 'https://untrusted.example' })).response.status, 403);
  const catalog = await context.request('/api/admin/v1/catalog');
  assert.equal(catalog.response.status, 200); assert.equal(catalog.payload.data.session.role, 'owner');
  assert.equal((await context.request('/api/admin/v1/setup', { method: 'POST', body: owner })).response.status, 422);
}));

test('draft CRUD persists across database reopen and stale changes produce HTTP 409', async () => withBackend(async context => {
  await context.setup();
  const record = await context.save('drinkTypes', { ...newEntity('API test tea', 'api-test-tea'), description: 'Draft record', position: 20 });
  assert.equal(record.revision, 1);
  const saved = await context.save('drinkTypes', { ...record, description: 'New description' }, 1);
  assert.equal(saved.revision, 2);
  const stale = await context.request('/api/admin/v1/record', { method: 'POST', body: { collection: 'drinkTypes', record: { ...record, description: 'Stale overwrite' }, expectedRevision: 1 } });
  assert.equal(stale.response.status, 409); assert.equal(stale.payload.error.code.toLowerCase(), 'revision_conflict');
  context.reopen();
  const reload = await context.request('/api/admin/v1/catalog');
  assert.equal(reload.response.status, 200, 'Persistent owner session remains valid');
  const persistent = reload.payload.data.catalog.drinkTypes.find(item => item.id === record.id);
  assert.equal(persistent.description, 'New description'); assert.equal(persistent.revision, 2);
  const archive = await context.request('/api/admin/v1/archive', { method: 'POST', body: { collection: 'drinkTypes', id: record.id, expectedRevision: 2 } });
  assert.equal(archive.response.status, 200);
  context.reopen();
  assert.equal((await context.repository.readDraft()).drinkTypes.find(item => item.id === record.id).lifecycle, 'archived');
}));

test('trusted media metadata must come from file inspection and cannot be forged through CRUD', async () => withBackend(async context => {
  await context.setup();
  const forged = { ...newEntity('Forged media', 'forged-media'), role: 'image-2d', status: 'ready', url: '/api/public/v1/media/forged-media', storageKey: `${'a'.repeat(64)}.jpg`, mime: 'image/jpeg', bytes: 12, sha256: 'a'.repeat(64), width: 100, height: 100, imageBounds: null, error: '' };
  const creation = await context.request('/api/admin/v1/record', { method: 'POST', body: { collection: 'media', record: forged, expectedRevision: null } });
  assert.equal(creation.response.status, 422); assert.equal(creation.payload.error.code, 'MEDIA_UPLOAD_REQUIRED');
  const { media } = await context.upload();
  for (const patch of [{ status: 'processing' }, { mime: 'text/html' }, { storageKey: `${'b'.repeat(64)}.jpg` }, { sha256: 'b'.repeat(64) }, { url: 'https://uninspected.example/file.jpg' }, { role: 'label' }]) {
    const result = await context.request('/api/admin/v1/record', { method: 'POST', body: { collection: 'media', record: { ...media, ...patch }, expectedRevision: media.revision } });
    assert.equal(result.response.status, 422); assert.equal(result.payload.error.code, 'MEDIA_IMMUTABLE');
  }
  const renamed = await context.save('media', { ...media, name: 'Human-facing artwork name' }, media.revision);
  assert.equal(renamed.name, 'Human-facing artwork name'); assert.equal(renamed.storageKey, media.storageKey);
  assert.equal((await context.request(`/api/public/v1/media/${media.id}`, { cookie: '' })).response.status, 404, 'Unpublished upload remains private');
  const preview = await context.request(`/api/public/v1/media/${media.id}`);
  assert.equal(preview.response.status, 200); assert.match(preview.response.headers.get('Cache-Control'), /private/);
}));

test('button reorder checks every revision in its group and does not change another group', async () => withBackend(async context => {
  await context.setup();
  const group = await context.save('productGroups', { ...newEntity('Reorder group', 'reorder-group'), drinkTypeId: 'juice', description: '', buttonLabel: 'Order test', position: 20, visible: false });
  const otherGroup = await context.save('productGroups', { ...newEntity('Other group', 'other-order-group'), drinkTypeId: 'juice', description: '', buttonLabel: 'Other order test', position: 21, visible: false });
  const makeSlot = (id, groupId, packagingVariantId, position) => ({ ...newEntity(id, id), groupId, packagingVariantId, regionKey: 'packaging-picker', position, buttonLabel: id, mode: '2d', defaultVariantId: null, enabled: true });
  const first = await context.save('packagingSlots', makeSlot('order-slot-330', group.id, 'can-330', 0));
  const second = await context.save('packagingSlots', makeSlot('order-slot-250', group.id, 'can-250', 1));
  const unrelated = await context.save('packagingSlots', makeSlot('other-order-slot', otherGroup.id, 'can-330', 0));
  const revisions = { [first.id]: first.revision, [second.id]: second.revision };
  const result = await context.request('/api/admin/v1/reorder', { method: 'POST', body: { collection: 'packagingSlots', id: first.id, direction: 'down', expectedRevisions: revisions } });
  assert.equal(result.response.status, 200);
  const slots = result.payload.data.packagingSlots;
  assert.equal(slots.find(slot => slot.id === first.id).position, 1); assert.equal(slots.find(slot => slot.id === second.id).position, 0);
  assert.equal(slots.find(slot => slot.id === first.id).revision, 2); assert.equal(slots.find(slot => slot.id === second.id).revision, 2);
  assert.equal(slots.find(slot => slot.id === unrelated.id).revision, unrelated.revision); assert.equal(slots.find(slot => slot.id === unrelated.id).position, unrelated.position);
  const stale = await context.request('/api/admin/v1/reorder', { method: 'POST', body: { collection: 'packagingSlots', id: first.id, direction: 'up', expectedRevisions: revisions } });
  assert.equal(stale.response.status, 409);
  const missingRevisions = await context.request('/api/admin/v1/reorder', { method: 'POST', body: { collection: 'packagingSlots', id: first.id, direction: 'up' } });
  assert.equal(missingRevisions.response.status, 409);
  const persisted = await context.repository.readDraft();
  assert.equal(persisted.packagingSlots.find(slot => slot.id === first.id).position, 1);
  assert.equal(persisted.packagingSlots.find(slot => slot.id === first.id).revision, 2);
}));

test('2D operational workflow publishes an immutable reachable graph, then updates and rolls back safely', async () => withBackend(async context => {
  await context.setup();
  const product = await createVisible2DProduct(context);
  const preflight = await context.request('/api/admin/v1/preflight');
  assert.equal(preflight.response.status, 200); assert.deepEqual(preflight.payload.data.filter(issue => issue.severity === 'error'), []);
  const publish = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'First 2D release', expectedReleaseId: null } });
  assert.equal(publish.response.status, 201, JSON.stringify(publish.payload));
  const first = publish.payload.data;
  const publicRead = await context.request('/api/public/v1/catalog', { cookie: '' });
  assert.equal(publicRead.response.status, 200); assert.equal(publicRead.payload.data.releaseId, first.id);
  const publicCatalog = publicRead.payload.data.catalog;
  assert.equal(publicCatalog.productGroups.length, 1); assert.equal(publicCatalog.productGroups[0].buttonLabel, 'Juice 30%');
  assert.equal(publicCatalog.models3d.length, 0); assert.equal(publicCatalog.labels.length, 0);
  assert.equal(publicCatalog.media.length, 1); assert.equal(publicCatalog.media[0].id, product.media.id);
  assert.equal(publicCatalog.packagingCategories.length, 1); assert.equal(publicCatalog.drinkTypes.length, 1);
  const media = await context.request(`/api/public/v1/media/${product.media.id}`, { cookie: '' });
  assert.equal(media.response.status, 200); assert.match(media.response.headers.get('Cache-Control'), /immutable/);
  assert.equal(media.response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(Buffer.from(await media.response.arrayBuffer()), product.bytes);
  const edited = await context.save('productGroups', { ...product.group, buttonLabel: 'Juice 50%' }, product.group.revision);
  assert.equal(edited.buttonLabel, 'Juice 50%');
  const whileDraft = await context.request('/api/public/v1/catalog', { cookie: '' });
  assert.equal(whileDraft.payload.data.catalog.productGroups[0].buttonLabel, 'Juice 30%');
  const publish2 = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'Second release', expectedReleaseId: first.id } });
  assert.equal(publish2.response.status, 201); const second = publish2.payload.data;
  assert.notEqual(second.id, first.id);
  assert.equal((await context.request('/api/public/v1/catalog', { cookie: '' })).payload.data.catalog.productGroups[0].buttonLabel, 'Juice 50%');
  const stalePublish = await context.request('/api/admin/v1/publish', { method: 'POST', body: { expectedReleaseId: first.id } });
  assert.equal(stalePublish.response.status, 409);
  const rollback = await context.request('/api/admin/v1/rollback', { method: 'POST', body: { releaseId: first.id, expectedReleaseId: second.id } });
  assert.equal(rollback.response.status, 200);
  context.reopen();
  assert.equal((await context.request('/api/public/v1/catalog', { cookie: '' })).payload.data.catalog.productGroups[0].buttonLabel, 'Juice 30%');
  assert.equal((await context.repository.readDraft()).productGroups.find(item => item.id === product.group.id).buttonLabel, 'Juice 50%');
  const history = await context.request('/api/admin/v1/catalog');
  assert.equal(history.payload.data.releases.length, 2); assert.equal(history.payload.data.activeReleaseId, first.id);
}));

test('editor sessions cannot publish or rollback and owner logout revokes access', async () => withBackend(async context => {
  const ownerCookie = await context.setup();
  const id = randomUUID();
  context.repository.database.prepare('INSERT INTO admin_users VALUES(?,?,?,?,?)').run(id, 'editor@example.test', '0'.repeat(128), 'test-salt', 'editor');
  const token = context.repository.createSession({ userId: id, email: 'editor@example.test', role: 'editor' });
  const editorCookie = `vinut_admin_session=${token}`;
  const editRead = await context.request('/api/admin/v1/catalog', { cookie: editorCookie });
  assert.equal(editRead.response.status, 200);
  assert.equal((await context.request('/api/admin/v1/publish', { method: 'POST', cookie: editorCookie, body: { expectedReleaseId: null } })).response.status, 403);
  assert.equal((await context.request('/api/admin/v1/rollback', { method: 'POST', cookie: editorCookie, body: { releaseId: 'any', expectedReleaseId: null } })).response.status, 403);
  assert.equal((await context.request('/api/admin/v1/logout', { method: 'POST', cookie: ownerCookie })).response.status, 200);
  assert.equal((await context.request('/api/admin/v1/catalog', { cookie: ownerCookie })).response.status, 401);
  const login = await context.request('/api/admin/v1/login', { method: 'POST', cookie: '', body: owner });
  assert.equal(login.response.status, 200); assert.ok(login.response.headers.get('Set-Cookie'));
}));

test('archive impact blocks removing artwork currently used by a published product', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const usage = await context.request(`/api/admin/v1/usage?collection=media&id=${product.media.id}`);
  assert.equal(usage.response.status, 200); assert.equal(usage.payload.data.affectsPublic, true); assert.ok(usage.payload.data.blockingIssues.length);
  const archive = await context.request('/api/admin/v1/archive', { method: 'POST', body: { collection: 'media', id: product.media.id, expectedRevision: product.media.revision } });
  assert.equal(archive.response.status, 422); assert.equal(archive.payload.error.code, 'archive_in_use');
  assert.equal((await context.repository.readDraft()).media.find(item => item.id === product.media.id).lifecycle, 'active');
}));

test('unexpected storage failures return a generic server error without exposing filesystem details', async () => withBackend(async context => {
  await context.setup(); const { media } = await context.upload();
  fs.unlinkSync(getMediaPath(media.storageKey, context.folder));
  const result = await context.request(`/api/public/v1/media/${media.id}`);
  assert.equal(result.response.status, 500);
  assert.equal(result.payload.error.code, 'SERVER_ERROR');
  assert.ok(!JSON.stringify(result.payload).includes(context.folder));
  assert.ok(!JSON.stringify(result.payload).includes(media.storageKey));
}));

test('file-aware preflight and publication reject missing or corrupt media and preserve the current release', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const initial = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'Known good release', expectedReleaseId: null } });
  assert.equal(initial.response.status, 201); const first = initial.payload.data;
  const replacement = await context.upload('image-2d', 'berry-preview.jpg');
  assert.notEqual(replacement.media.storageKey, product.media.storageKey);
  await context.save('assets2d', { ...product.asset, mediaId: replacement.media.id }, product.asset.revision);
  const target = getMediaPath(replacement.media.storageKey, context.folder);
  for (const condition of ['deleted', 'corrupted']) {
    if (condition === 'deleted') fs.unlinkSync(target); else fs.writeFileSync(target, Buffer.from('corrupt image data'));
    const preflight = await context.request('/api/admin/v1/preflight');
    assert.equal(preflight.response.status, 200);
    assert.ok(preflight.payload.data.some(issue => issue.severity === 'error' && issue.collection === 'media' && issue.entityId === replacement.media.id), `${condition} file must be reported before publish`);
    const rejected = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: `Reject ${condition}`, expectedReleaseId: first.id } });
    assert.equal(rejected.response.status, 422, `${condition} asset cannot become public`);
    assert.equal((await context.repository.readActiveRelease()).id, first.id);
    assert.equal((await context.repository.listReleases()).length, 1, 'Failed publication leaves no partial release');
    const currentMedia = await context.request(`/api/public/v1/media/${product.media.id}`, { cookie: '' });
    assert.equal(currentMedia.response.status, 200); assert.deepEqual(Buffer.from(await currentMedia.response.arrayBuffer()), product.bytes);
    fs.writeFileSync(target, replacement.bytes);
  }
  const verified = await context.request('/api/admin/v1/preflight');
  assert.deepEqual(verified.payload.data.filter(issue => issue.severity === 'error'), []);
  const valid = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'Verified replacement', expectedReleaseId: first.id } });
  assert.equal(valid.response.status, 201); assert.notEqual(valid.payload.data.id, first.id);
}));

test('rollback verifies retained media and preserves the active release when an old asset is missing', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const initial = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'Original artwork', expectedReleaseId: null } });
  assert.equal(initial.response.status, 201); const first = initial.payload.data;
  const replacement = await context.upload('image-2d', 'berry-preview.jpg');
  await context.save('assets2d', { ...product.asset, mediaId: replacement.media.id }, product.asset.revision);
  const updated = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'Replacement artwork', expectedReleaseId: first.id } });
  assert.equal(updated.response.status, 201); const second = updated.payload.data;
  const oldPath = getMediaPath(product.media.storageKey, context.folder);
  fs.unlinkSync(oldPath);
  const rejected = await context.request('/api/admin/v1/rollback', { method: 'POST', body: { releaseId: first.id, expectedReleaseId: second.id } });
  assert.equal(rejected.response.status, 422);
  assert.equal((await context.repository.readActiveRelease()).id, second.id);
  const current = await context.request(`/api/public/v1/media/${replacement.media.id}`, { cookie: '' });
  assert.equal(current.response.status, 200); assert.deepEqual(Buffer.from(await current.response.arrayBuffer()), replacement.bytes);
  fs.writeFileSync(oldPath, product.bytes);
  const restored = await context.request('/api/admin/v1/rollback', { method: 'POST', body: { releaseId: first.id, expectedReleaseId: second.id } });
  assert.equal(restored.response.status, 200); assert.equal((await context.repository.readActiveRelease()).id, first.id);
}));

test('stale draft snapshots cannot publish newer edits that the owner has not reviewed', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const reviewedHash = createHash('sha256').update(JSON.stringify(await context.repository.readDraft())).digest('hex');
  await context.save('productGroups', { ...product.group, buttonLabel: 'Unreviewed Juice 50%' }, product.group.revision);
  const rejected = await context.request('/api/admin/v1/publish', { method: 'POST', headers: { 'X-Idempotency-Key': randomUUID() }, body: { note: 'Publish reviewed version', expectedReleaseId: null, expectedDraftHash: reviewedHash } });
  assert.equal(rejected.response.status, 409); assert.equal(rejected.payload.error.code.toLowerCase(), 'revision_conflict');
  assert.equal(await context.repository.readActiveRelease(), null); assert.equal((await context.repository.listReleases()).length, 0);
  const freshHash = createHash('sha256').update(JSON.stringify(await context.repository.readDraft())).digest('hex');
  const reviewed = await context.request('/api/admin/v1/publish', { method: 'POST', headers: { 'X-Idempotency-Key': randomUUID() }, body: { note: 'Owner reviewed refreshed version', expectedReleaseId: null, expectedDraftHash: freshHash } });
  assert.equal(reviewed.response.status, 201); assert.equal(reviewed.payload.data.data.productGroups[0].buttonLabel, 'Unreviewed Juice 50%');
}));

test('publish retries are idempotent, reject key reuse and never reactivate a superseded release', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const expectedDraftHash = createHash('sha256').update(JSON.stringify(await context.repository.readDraft())).digest('hex');
  const requestKey = randomUUID();
  const body = { note: 'Idempotent first release', expectedReleaseId: null, expectedDraftHash };
  const options = { method: 'POST', headers: { 'X-Idempotency-Key': requestKey }, body };
  const initial = await context.request('/api/admin/v1/publish', options);
  assert.equal(initial.response.status, 201); const first = initial.payload.data;
  const retry = await context.request('/api/admin/v1/publish', options);
  assert.equal(retry.response.status, 201); assert.equal(retry.payload.data.id, first.id);
  assert.equal((await context.repository.listReleases()).length, 1);
  const changedNote = await context.request('/api/admin/v1/publish', { ...options, body: { ...body, note: 'Different publication intent' } });
  assert.equal(changedNote.response.status, 409); assert.equal(changedNote.payload.error.code.toLowerCase(), 'idempotency_conflict');
  await context.save('productGroups', { ...product.group, buttonLabel: 'New reviewed Juice 50%' }, product.group.revision);
  const latestHash = createHash('sha256').update(JSON.stringify(await context.repository.readDraft())).digest('hex');
  const latestBody = { note: 'Second release', expectedReleaseId: first.id, expectedDraftHash: latestHash };
  const reused = await context.request('/api/admin/v1/publish', { ...options, body: latestBody });
  assert.equal(reused.response.status, 409); assert.equal(reused.payload.error.code.toLowerCase(), 'idempotency_conflict');
  assert.equal((await context.repository.readActiveRelease()).id, first.id);
  const second = await context.request('/api/admin/v1/publish', { method: 'POST', headers: { 'X-Idempotency-Key': randomUUID() }, body: latestBody });
  assert.equal(second.response.status, 201); assert.notEqual(second.payload.data.id, first.id);
  const delayedRetry = await context.request('/api/admin/v1/publish', options);
  assert.equal(delayedRetry.response.status, 201); assert.equal(delayedRetry.payload.data.id, first.id);
  assert.equal((await context.repository.readActiveRelease()).id, second.payload.data.id, 'An old network retry must not roll back the current site');
  assert.equal((await context.repository.listReleases()).length, 2);
  const otherOwnerId = randomUUID();
  context.repository.database.prepare('INSERT INTO admin_users VALUES(?,?,?,?,?)').run(otherOwnerId, 'other-owner@example.test', '0'.repeat(128), 'test-salt', 'owner');
  const otherToken = context.repository.createSession({ userId: otherOwnerId, email: 'other-owner@example.test', role: 'owner' });
  const otherActor = await context.request('/api/admin/v1/publish', { ...options, cookie: `vinut_admin_session=${otherToken}` });
  assert.equal(otherActor.response.status, 409, 'Idempotency keys must be scoped to their original actor');
  assert.equal(otherActor.payload.error.code.toLowerCase(), 'revision_conflict');
}));

test('published media remains available to older pages while unrelated draft uploads stay private', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const first = await context.request('/api/admin/v1/publish', { method: 'POST', body: { expectedReleaseId: null } });
  assert.equal(first.response.status, 201);
  const replacement = await context.upload('image-2d', 'berry-preview.jpg');
  const unused = await context.upload('image-2d', 'peach-preview.jpg');
  await context.save('assets2d', { ...product.asset, mediaId: replacement.media.id }, product.asset.revision);
  const second = await context.request('/api/admin/v1/publish', { method: 'POST', body: { expectedReleaseId: first.payload.data.id } });
  assert.equal(second.response.status, 201);
  const current = await context.request('/api/public/v1/catalog', { cookie: '' });
  assert.equal(current.payload.data.catalog.media.some(media => media.id === product.media.id), false, 'Replacement removes the old image from the current snapshot');
  context.reopen();
  const retained = await context.request(`/api/public/v1/media/${product.media.id}`, { cookie: '' });
  assert.equal(retained.response.status, 200, 'Previously published immutable URL remains readable');
  assert.deepEqual(Buffer.from(await retained.response.arrayBuffer()), product.bytes);
  const replacementRead = await context.request(`/api/public/v1/media/${replacement.media.id}`, { cookie: '' });
  assert.equal(replacementRead.response.status, 200); assert.deepEqual(Buffer.from(await replacementRead.response.arrayBuffer()), replacement.bytes);
  assert.equal((await context.request(`/api/public/v1/media/${unused.media.id}`, { cookie: '' })).response.status, 404);
}));

test('real 3D model publication validates declared material names against the inspected GLB', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const labelMedia = (await context.upload('label')).media;
  const posterMedia = (await context.upload('poster')).media;
  const seedModel = (await context.repository.readDraft()).models3d.find(model => model.packagingVariantId === 'can-330');
  let model = await context.save('models3d', { ...seedModel, posterId: posterMedia.id }, seedModel.revision);
  const label = await context.save('labels', { ...newEntity('API approved label', 'api-3d-label'), drinkTypeId: 'juice', flavorId: product.flavor.id, mediaId: labelMedia.id, compatibilities: [{ packagingVariantId: 'can-330', layoutProfile: model.layoutProfile }] });
  await context.save('displays3d', { ...newEntity('API approved 3D display', 'api-3d-display'), productVariantId: product.variant.id, modelId: model.id, labelId: label.id, enabled: true });
  await context.save('packagingSlots', { ...product.slot, mode: '3d' }, product.slot.revision);
  const invalid = await context.save('models3d', { ...model, materialSlots: { ...model.materialSlots, label: ['material-that-does-not-exist'] } }, model.revision);
  const preflight = await context.request('/api/admin/v1/preflight');
  assert.ok(preflight.payload.data.some(issue => issue.entityId === model.id && issue.field === 'materialSlots' && issue.severity === 'error'));
  const rejected = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'Incorrect model slot', expectedReleaseId: null } });
  assert.equal(rejected.response.status, 422); assert.equal(await context.repository.readActiveRelease(), null);
  model = await context.save('models3d', { ...invalid, materialSlots: seedModel.materialSlots }, invalid.revision);
  const corrected = await context.request('/api/admin/v1/preflight');
  assert.deepEqual(corrected.payload.data.filter(issue => issue.severity === 'error'), []);
  const published = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'Actual can GLB and valid label', expectedReleaseId: null } });
  assert.equal(published.response.status, 201, JSON.stringify(published.payload));
  const catalog = published.payload.data.data;
  assert.equal(catalog.models3d.length, 1); assert.equal(catalog.models3d[0].id, model.id);
  assert.deepEqual(catalog.models3d[0].materialSlots.label, ['printed-label']);
  assert.equal(catalog.displays3d[0].labelId, label.id);
  assert.equal(catalog.media.find(media => media.id === seedModel.mediaId).mime, 'model/gltf-binary');
  const labelRead = await context.request(`/api/public/v1/media/${labelMedia.id}`, { cookie: '' });
  assert.equal(labelRead.response.status, 200); assert.equal(labelRead.response.headers.get('Content-Type'), labelMedia.mime);
}));

test('CRUD audit events identify the actual authenticated owner or editor', async () => withBackend(async context => {
  await context.setup();
  const record = await context.save('drinkTypes', { ...newEntity('Audited tea', 'audited-tea'), description: '', position: 25 });
  const editorId = randomUUID(); const editorEmail = 'audit-editor@example.test';
  context.repository.database.prepare('INSERT INTO admin_users VALUES(?,?,?,?,?)').run(editorId, editorEmail, '0'.repeat(128), 'test-salt', 'editor');
  const token = context.repository.createSession({ userId: editorId, email: editorEmail, role: 'editor' });
  const cookie = `vinut_admin_session=${token}`;
  const edit = await context.request('/api/admin/v1/record', { method: 'POST', cookie, body: { collection: 'drinkTypes', record: { ...record, description: 'Editor contribution' }, expectedRevision: record.revision } });
  assert.equal(edit.response.status, 200);
  const archive = await context.request('/api/admin/v1/archive', { method: 'POST', cookie, body: { collection: 'drinkTypes', id: record.id, expectedRevision: edit.payload.data.revision } });
  assert.equal(archive.response.status, 200);
  const events = context.repository.database.prepare('SELECT actor,action FROM audit_events WHERE entity_id=? ORDER BY rowid').all(record.id);
  assert.deepEqual(events.map(event => ({ ...event })), [
    { actor: owner.email, action: 'save:drinkTypes' },
    { actor: editorEmail, action: 'save:drinkTypes' },
    { actor: editorEmail, action: 'archive:drinkTypes' },
  ]);
}));

test('reordering an image pool changes only assets belonging to that flavor', async () => withBackend(async context => {
  await context.setup();
  const firstMedia = (await context.upload('fruit')).media;
  const secondMedia = (await context.upload('fruit', 'berry-preview.jpg')).media;
  const makeAsset = (id, flavorId, mediaId, position) => ({ ...newEntity(id, id), flavorId, mediaId, role: 'fruit', position, enabled: true });
  const first = await context.save('flavorAssets', makeAsset('ordered-citrus-first', 'citrus', firstMedia.id, 0));
  const second = await context.save('flavorAssets', makeAsset('ordered-citrus-second', 'citrus', secondMedia.id, 1));
  const unrelated = await context.save('flavorAssets', makeAsset('ordered-berry-first', 'berry', firstMedia.id, 0));
  const result = await context.request('/api/admin/v1/reorder', { method: 'POST', body: { collection: 'flavorAssets', id: first.id, direction: 'down', expectedRevisions: { [first.id]: first.revision, [second.id]: second.revision } } });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  const assets = result.payload.data.flavorAssets;
  assert.equal(assets.find(asset => asset.id === first.id).position, 1); assert.equal(assets.find(asset => asset.id === second.id).position, 0);
  assert.equal(assets.find(asset => asset.id === first.id).revision, 2); assert.equal(assets.find(asset => asset.id === second.id).revision, 2);
  assert.deepEqual(assets.find(asset => asset.id === unrelated.id), unrelated, 'An unrelated flavor pool keeps its position, revision and timestamps');
}));
