import { readFile } from 'node:fs/promises';
import type { CatalogRecord, CollectionName } from '@/lib/catalog/contracts';
import { getArchiveImpact } from '@/lib/catalog/service';
import { LocalCatalogRepository } from './local-repository';
import { processUpload, getMediaPath } from './media/upload';

const collections = new Set<CollectionName>(['drinkTypes','packagingCategories','packagingVariants','flavors','flavorAssets','productGroups','productVariants','packagingSlots','media','labels','models3d','assets2d','displays3d','displays2d']);
const cookieName = 'vinut_admin_session';
function sessionToken(request: Request) { return request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length+1) || ''; }
function json(data: unknown, status=200, headers: HeadersInit={}) { return Response.json({ data },{status,headers:{'Cache-Control':'no-store',...headers}}); }
function fail(message:string,status:number,code='INVALID_REQUEST',issues?:unknown) { return Response.json({ error:{ code, message, issues } },{status,headers:{'Cache-Control':'no-store'}}); }
function collection(value: unknown): CollectionName { if (typeof value !== 'string' || !collections.has(value as CollectionName)) throw new Error('Danh mục không hợp lệ.'); return value as CollectionName; }

export function createAdminHandler(repository:LocalCatalogRepository,options:{allowedOrigins?:string[];dataDir?:string}={}) {
  const origins = new Set(options.allowedOrigins || ['http://localhost:3000','http://127.0.0.1:3000']);
  return async function handle(request:Request):Promise<Response> {
    const origin = request.headers.get('origin');
    const headers = new Headers();
    if (origin && origins.has(origin)) { headers.set('Access-Control-Allow-Origin',origin); headers.set('Access-Control-Allow-Credentials','true'); headers.set('Vary','Origin'); }
    headers.set('Access-Control-Allow-Methods','GET,POST,OPTIONS'); headers.set('Access-Control-Allow-Headers','Content-Type,X-Idempotency-Key');
    const respond = (response:Response) => { headers.forEach((value,key) => response.headers.set(key,value)); return response; };
    if (origin && !origins.has(origin)) return respond(fail('Origin chưa được cho phép.',403,'FORBIDDEN'));
    if (request.method === 'OPTIONS') return respond(new Response(null,{status:204}));
    if (request.method !== 'GET' && !origin) return respond(fail('Request ghi dữ liệu cần Origin hợp lệ.',403,'FORBIDDEN'));
    const url = new URL(request.url), path=url.pathname.replace(/\/$/,'');
    const token=sessionToken(request), user=repository.session(token);
    try {
      if (path === '/api/admin/v1/session' && request.method === 'GET') return respond(json({session:user,needsSetup:repository.needsSetup(),backend:'local-sqlite'}));
      if (path === '/api/admin/v1/setup' && request.method === 'POST') {
        const body=await request.json();
        const owner=repository.bootstrapOwner(String(body.email||''),String(body.password||'')), secret=repository.createSession(owner);
        return respond(json(owner,201,{'Set-Cookie':`${cookieName}=${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800`}));
      }
      if (path === '/api/admin/v1/login' && request.method === 'POST') {
        const body=await request.json();
        const account=repository.login(String(body.email||''),String(body.password||'')), secret=repository.createSession(account);
        return respond(json(account,200,{'Set-Cookie':`${cookieName}=${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800`}));
      }
      if (path === '/api/admin/v1/logout' && request.method === 'POST') { repository.revokeSession(token); return respond(json(null,200,{'Set-Cookie':`${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`})); }
      if (path === '/api/public/v1/catalog' && request.method === 'GET') {
        const release=await repository.readActiveRelease();
        if (!release) return respond(fail('Chưa có bản dữ liệu được xuất bản.',404,'NO_RELEASE'));
        const { data, id, schemaVersion, createdAt }=release;
        return respond(json({catalog:data,releaseId:id,schemaVersion,publishedAt:createdAt}));
      }
      if (path.startsWith('/api/public/v1/media/') && request.method === 'GET') {
        const id=path.slice('/api/public/v1/media/'.length);
        const media=user?(await repository.readDraft()).media.find(item=>item.id===id&&item.status==='ready')||await repository.readPublishedMedia(id):await repository.readPublishedMedia(id);
        if (!media || !media.storageKey) return respond(fail('Không tìm thấy tài nguyên.',404,'NOT_FOUND'));
        const buffer=await readFile(getMediaPath(media.storageKey,options.dataDir));
        return respond(new Response(new Uint8Array(buffer),{headers:{'Content-Type':media.mime,'X-Content-Type-Options':'nosniff','Cache-Control':user?'private, no-store':'public, max-age=31536000, immutable'}}));
      }
      if (!user) return respond(fail('Vui lòng đăng nhập quản trị.',401,'UNAUTHORIZED'));
      if (path === '/api/admin/v1/catalog' && request.method === 'GET') return respond(json({catalog:await repository.readDraft(),releases:await repository.listReleases(),activeReleaseId:(await repository.readActiveRelease())?.id||null,session:user}));
      if (path === '/api/admin/v1/usage' && request.method === 'GET') return respond(json(getArchiveImpact(await repository.readDraft(),collection(url.searchParams.get('collection')),url.searchParams.get('id')||'')));
      if (path === '/api/admin/v1/record' && request.method === 'POST') {
        const body=await request.json();
        const targetCollection=collection(body.collection);
        if (targetCollection==='media') {
          const existing=(await repository.readDraft()).media.find(item=>item.id===body.record?.id);
          if(!existing) return respond(fail('Tài nguyên mới phải được tạo bằng upload đã kiểm tra.',422,'MEDIA_UPLOAD_REQUIRED'));
          for(const field of ['role','status','url','storageKey','mime','bytes','sha256','width','height','imageBounds','error'] as const) {
            if(JSON.stringify(existing[field])!==JSON.stringify(body.record?.[field])) return respond(fail('Thông tin file đã kiểm tra không được sửa trực tiếp. Hãy upload phiên bản mới.',422,'MEDIA_IMMUTABLE'));
          }
        }
        const saved=await repository.saveRecord(targetCollection,body.record as CatalogRecord,body.expectedRevision??null,user.email);
        return respond(json(saved));
      }
      if (path === '/api/admin/v1/archive' && request.method === 'POST') { const body=await request.json(); await repository.archiveRecord(collection(body.collection),String(body.id),Number(body.expectedRevision),user.email); return respond(json(null)); }
      if (path === '/api/admin/v1/reorder' && request.method === 'POST') {
        const body=await request.json(); if (!['up','down'].includes(body.direction)) return respond(fail('Hướng thay đổi thứ tự không hợp lệ.',422));
        return respond(json(await repository.reorder(collection(body.collection),String(body.id),body.direction,body.expectedRevisions||{},user.email)));
      }
      if (path === '/api/admin/v1/upload' && request.method === 'POST') {
        const form=await request.formData(), file=form.get('file');
        if (!(file instanceof File)) return respond(fail('Chưa chọn file.',422));
        const media=await processUpload(file, String(form.get('role')||'') as import('@/lib/catalog/contracts').MediaRole,options.dataDir);
        return respond(json(await repository.saveRecord('media',media,null,user.email),201));
      }
      if (path === '/api/admin/v1/preflight' && request.method === 'GET') return respond(json(await repository.preflight()));
      if (path === '/api/admin/v1/publish' && request.method === 'POST') {
        if (user.role !== 'owner') return respond(fail('Chỉ chủ quản trị được xuất bản.',403,'FORBIDDEN'));
        const body=await request.json();
        const expectedDraftHash=typeof body.expectedDraftHash==='string'?body.expectedDraftHash:undefined;
        const requestKey=request.headers.get('X-Idempotency-Key')||undefined;
        if(expectedDraftHash&&!/^[a-f0-9]{64}$/.test(expectedDraftHash)||requestKey&&!/^[a-zA-Z0-9-]{8,128}$/.test(requestKey))return respond(fail('Thông tin kiểm tra bản phát hành không hợp lệ.',422));
        return respond(json(await repository.publish(await repository.readDraft(),user.email,String(body.note||''),body.expectedReleaseId??null,{expectedDraftHash,requestKey}),201));
      }
      if (path === '/api/admin/v1/rollback' && request.method === 'POST') {
        if (user.role !== 'owner') return respond(fail('Chỉ chủ quản trị được khôi phục phiên bản.',403,'FORBIDDEN'));
        const body=await request.json(); await repository.rollback(String(body.releaseId),user.email,body.expectedReleaseId??null); return respond(json(null));
      }
      return respond(fail('Không tìm thấy API.',404,'NOT_FOUND'));
    } catch(error) {
      const detail=error as {code?:string;message?:string;issues?:unknown};
      if(detail.code&&/^E[A-Z_]+$/.test(detail.code)||detail.code?.startsWith('ERR_')) return respond(fail('Không xử lý được yêu cầu. Vui lòng thử lại hoặc kiểm tra backend.',500,'SERVER_ERROR'));
      const code=detail.code||'INVALID_REQUEST';
      const status=code.toLowerCase().includes('conflict')?409:code==='UNAUTHORIZED'?401:code==='RATE_LIMITED'?429:422;
      return respond(fail(detail.message||'Không xử lý được yêu cầu.',status,code,detail.issues));
    }
  };
}
