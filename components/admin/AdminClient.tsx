'use client';

import { mergeFlavorPoolAsset } from '@/lib/catalog/flavor-pool-library';

import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Leaf, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import AdminApp from './AdminApp';
import DisplayWorkspace from './display/DisplayWorkspace';
import PublishingWorkspace from './publishing/PublishingWorkspace';
import OperationsWorkspace from './operations/OperationsWorkspace';
import type { AdminSession, CatalogData, CatalogRecord, CatalogRelease, CollectionName, DisplayAction, DisplayDraftResult, DisplayDraftSave, FlavorAsset, FlavorPoolAssetInput, MediaAsset, MediaRole, ValidationIssue } from '@/lib/catalog/contracts';
import { publicUrl } from '@/lib/public-url';
import styles from './client.module.css';

type Bootstrap = { session: AdminSession | null; needsSetup: boolean; backend: string };
type Workspace = { session: AdminSession; catalog: CatalogData; releases: Omit<CatalogRelease,'data'>[]; activeReleaseId: string | null };
const apiBase = () => (process.env.NEXT_PUBLIC_ADMIN_API_URL || publicUrl('/')).replace(/\/$/, '');
async function request<T>(endpoint: string, body?: unknown, form?: FormData, idempotencyKey?:string): Promise<T> {
  const response = await fetch(`${apiBase()}/api/admin/v1/${endpoint}`, { credentials: 'include', cache: 'no-store', ...(body !== undefined || form ? { method: 'POST', ...(form ? {body:form} : {body:JSON.stringify(body),headers:{'Content-Type':'application/json',...(idempotencyKey?{'X-Idempotency-Key':idempotencyKey}:{})}}) } : {}) });
  const result = await response.json();
  if (!response.ok) {
    const issues = (result.error?.issues || []) as ValidationIssue[];
    throw new Error([result.error?.message || 'Không thể kết nối API.', ...issues.slice(0,4).map(issue => issue.message)].join(' '));
  }
  return result.data as T;
}

export default function AdminClient() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => { setWorkspace(await request<Workspace>('catalog')); }, []);
  const connect = useCallback(async () => {
    setLoading(true); setError('');
    try { const data = await request<Bootstrap>('session'); setBootstrap(data); if(data.session) await refresh(); else setWorkspace(null); }
    catch { setError('Backend admin chưa chạy hoặc chưa truy cập được. Mở bản demo bằng npm run dev:admin rồi tải lại.'); }
    finally { setLoading(false); }
  }, [refresh]);
  useEffect(() => { const timer=window.setTimeout(()=>void connect(),0); return()=>window.clearTimeout(timer); }, [connect]);

  async function authenticate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    try { const session = await request<AdminSession>(bootstrap?.needsSetup ? 'setup' : 'login', {email,password}); setPassword(''); setBootstrap({session,needsSetup:false,backend:'local-sqlite'}); await refresh(); }
    catch(cause) { setError(cause instanceof Error ? cause.message : 'Không thể đăng nhập.'); }
    finally { setBusy(false); }
  }
  async function save(collection:CollectionName, record:CatalogRecord, expectedRevision:number|null) {
    const saved=await request<CatalogRecord>('record',{collection,record,expectedRevision});
    setWorkspace(current=>current?{...current,catalog:{...current.catalog,[collection]:current.catalog[collection].some(item=>item.id===saved.id)?current.catalog[collection].map(item=>item.id===saved.id?saved:item):[...current.catalog[collection],saved]}}:current);
    return saved;
  }
  async function upload(file:File, role:MediaRole) {
    const form=new FormData();form.set('file',file);form.set('role',role);const saved=await request<MediaAsset>('upload',undefined,form);
    setWorkspace(current=>current?{...current,catalog:{...current.catalog,media:[...current.catalog.media,saved]}}:current);return saved;
  }
  async function saveDisplay(input: DisplayDraftSave) {
    const result = await request<DisplayDraftResult>('display', input);
    setWorkspace(current=>current?{...current,catalog:result.catalog}:current);
    return result;
  }
  async function addFlavorAsset(input: FlavorPoolAssetInput) {
    const saved = await request<FlavorAsset>('flavor-pool', input);
    setWorkspace(current => current ? { ...current, catalog: mergeFlavorPoolAsset(current.catalog, saved) } : current);
    return saved;
  }
  async function displayAction(input: DisplayAction) {
    try {
      const catalog = await request<CatalogData>('display/action', input);
      setWorkspace(current => current ? { ...current, catalog } : current);
      return catalog;
    } catch (cause) { await refresh().catch(() => {}); throw cause; }
  }

  async function deleteRecord(collection: CollectionName, id: string, expectedRevision: number, expectedDraftHash: string) {
    try {
      const result = await request<{catalog:CatalogData;issues:ValidationIssue[]}>('delete',{collection,id,expectedRevision,expectedDraftHash});
      setWorkspace(current => current ? { ...current, catalog: result.catalog } : current);
      return result;
    } catch (cause) { await refresh().catch(() => {}); throw cause; }
  }

  if (workspace && bootstrap?.session) return <AdminApp initialData={workspace.catalog} session={workspace.session} backendReady onSave={save} onAddFlavorAsset={addFlavorAsset} onDeleteRecord={deleteRecord} onSaveDisplay={saveDisplay} onUpload={upload} onArchive={async(collection,id,expectedRevision)=>{await request('archive',{collection,id,expectedRevision});await refresh();}} onReorder={async(collection,id,direction,expectedRevisions)=>{const catalog=await request<CatalogData>('reorder',{collection,id,direction,expectedRevisions});setWorkspace({...workspace,catalog});return catalog;}} onRefresh={refresh} onSignOut={async()=>{await request('logout',{});setWorkspace(null);setBootstrap({...bootstrap,session:null});}} renderWorkspace={(module,catalog,helpers)=>{
    if(module==='dashboard'||module==='analytics'||module==='security')return <OperationsWorkspace key={module} mode={module==='dashboard'?'overview':module} catalog={catalog} canAcknowledge={workspace.session.role==='owner'} onNavigate={helpers.onNavigate}/>;
    if(module==='displays3d'||module==='displays2d') return <DisplayWorkspace catalog={catalog} mode={module==='displays3d'?'3d':'2d'} onSave={helpers.onSave} onSaveDisplay={helpers.onSaveDisplay} onDisplayAction={displayAction} onDeleteRecord={deleteRecord} onUpload={helpers.onUpload!} onRefresh={refresh} />;
    if(module==='publishing') return <PublishingWorkspace catalog={catalog} releases={workspace.releases} activeReleaseId={workspace.activeReleaseId} canPublish={workspace.session.role==='owner'} onOpenIssue={helpers.onOpenIssue} onDeleteRecord={deleteRecord} onDeleteRelease={async(releaseId,expectedReleaseId)=>{
      try { await request('releases/delete',{releaseId,expectedReleaseId}); }
      catch (cause) { await refresh().catch(()=>{}); throw cause; }
      await refresh();
    }} onPreflight={()=>request<ValidationIssue[]>('preflight')} onPublish={async(note)=>{const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(catalog)));const expectedDraftHash=Array.from(new Uint8Array(bytes)).map(value=>value.toString(16).padStart(2,'0')).join('');const result=await request<CatalogRelease & {staticExportWarning?:string}>('publish',{note,expectedReleaseId:workspace.activeReleaseId,expectedDraftHash},undefined,crypto.randomUUID());await refresh();return result.staticExportWarning;}} onRollback={async(releaseId)=>{const result=await request<{staticExportWarning?:string}|null>('rollback',{releaseId,expectedReleaseId:workspace.activeReleaseId});await refresh();return result?.staticExportWarning;}} onRefresh={refresh}/>;
    return null;
  }}/>;

  return <main className={styles.shell}>
    <section className={styles.story}><a href={publicUrl('/')} className={styles.brand}><Leaf size={26}/><strong>VINUT <span>PRODUCT STUDIO</span></strong></a><div><p className={styles.eyebrow}>DỮ LIỆU · TÀI NGUYÊN · TRẢI NGHIỆM</p><h1>Một nơi cho toàn bộ<br/>thế giới sản phẩm.</h1><p>Quản lý hương vị, bao bì, artwork và mô hình. Xem trước từng tổ hợp trước khi đưa lên website.</p><div className={styles.steps}><span>01 <strong>Nhập dữ liệu</strong></span><span>02 <strong>Ghép & xem trước</strong></span><span>03 <strong>Phát hành</strong></span></div></div><small>Bản demo local · Dữ liệu lưu trên máy · Chưa thay đổi website đang chạy</small></section>
    <section className={styles.loginArea} aria-label="Đăng nhập quản trị"><div className={styles.card}>
      <span className={styles.icon}><ShieldCheck size={27}/></span><p className={styles.eyebrow}>KHÔNG GIAN QUẢN TRỊ</p><h2>{loading?'Đang kết nối…':bootstrap?.needsSetup?'Thiết lập chủ quản trị':'Chào mừng trở lại'}</h2><p>{bootstrap?.needsSetup?'Tạo tài khoản đầu tiên để quản lý bản demo.':'Đăng nhập để tiếp tục xây dựng danh mục sản phẩm.'}</p>
      {error&&<p className={styles.error} role="alert">{error}</p>}
      {loading?<div className={styles.loading} role="status"><LoaderCircle size={24}/> Đang kiểm tra phiên làm việc</div>:bootstrap?<form onSubmit={authenticate}><label>Email<input type="email" autoComplete="username" required maxLength={200} value={email} onChange={event=>setEmail(event.target.value)} placeholder="ten@congty.com"/></label><label>Mật khẩu<input type="password" autoComplete={bootstrap.needsSetup?'new-password':'current-password'} required minLength={bootstrap.needsSetup?12:1} maxLength={256} value={password} onChange={event=>setPassword(event.target.value)}/></label>{bootstrap.needsSetup&&<small>Ít nhất 12 ký tự. Không có tài khoản hoặc mật khẩu mặc định.</small>}<button disabled={busy} type="submit">{busy?<LoaderCircle size={18}/>:<ArrowRight size={18}/>} {bootstrap.needsSetup?'Tạo tài khoản & bắt đầu':'Đăng nhập'}</button></form>:<button className={styles.retry} onClick={()=>void connect()}><RefreshCw size={18}/> Kết nối lại</button>}
      <footer><ShieldCheck size={14}/> Phiên đăng nhập và dữ liệu nháp được bảo vệ.</footer>
    </div></section>
  </main>;
}
