import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isIP } from 'node:net';
import type { AdminSession } from '@/lib/catalog/contracts';
import { OperationsStore } from './operations';

export interface RequestContext { peerAddress?: string }
export function trustedPeerAddress(peer: string, forwarded: string, trusted: Set<string>) {
  const normalize = (value:string) => value.startsWith('::ffff:') ? value.slice(7) : value;
  let current=normalize(peer);
  const chain=forwarded.split(',').map(value=>normalize(value.trim()));
  while(trusted.has(current)&&chain.length){const next=chain.pop()!;if(!isIP(next))break;current=next;}
  return current;
}
export function requestByteLimit(path:string){return /\/(login|setup)$/.test(path)?8192:path.endsWith('/events')?32768:path.endsWith('/upload')?34*1024*1024:1048576;}
export async function readRequestJson(request: Request): Promise<unknown> {
  const limit = requestByteLimit(new URL(request.url).pathname);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw Object.assign(new Error('Cần dữ liệu JSON hợp lệ.'),{code:'INVALID_JSON'});
  const reader = request.body?.getReader(); let size=0;
  const chunks: Uint8Array[]=[];
  if(reader)while(true){const value=await reader.read();if(value.done)break;size+=value.value.length;if(size>limit){await reader.cancel().catch(()=>{});throw Object.assign(new Error('Request vượt kích thước cho phép.'),{code:'PAYLOAD_TOO_LARGE'});}chunks.push(value.value);}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Dữ liệu JSON không hợp lệ.'),{code:'INVALID_JSON'}); }
}
// The value's shape is validated by each endpoint; only the bounded parser is shared.
export async function readAdminJson(request: Request): Promise<Awaited<ReturnType<Request['json']>>> {
  const input=await readRequestJson(request);
  if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(new Error('Cần một đối tượng dữ liệu JSON.'),{code:'INVALID_JSON'});
  return input as Record<string,unknown>;
}
export function monitoredRoute(path: string) {
  if(isProbe(path)){
    let decoded=path;try{decoded=decodeURIComponent(path);}catch{/* retain normalized classification */}
    return /\.env/i.test(decoded)?'/probe/config-file':/\.git/i.test(decoded)?'/probe/git-directory':/wp-admin|wp-login/i.test(decoded)?'/probe/wordpress':/\.\.[/\\]|etc\/passwd/i.test(decoded)?'/probe/path-traversal':'/probe/sensitive-route';
  }
  if (/^\/api\/public\/v1\/media\/[^/]+$/.test(path)) return '/api/public/v1/media/:id';
  return /^\/api\/(admin|public)\/v1\/(session|setup|login|logout|catalog|usage|record|archive|display|display\/action|delete|reorder|upload|preflight|publish|rollback|releases\/delete|events|operations\/(analytics|security|logs|acknowledge))$/.test(path) ? path : '/unknown';
}
export function isProbe(path: string) {
  let decoded=path;try{decoded=decodeURIComponent(path);}catch{/* malformed encodings are treated as invalid routes */}
  return /(?:^|\/)(?:\.env(?:\.|\/|$)|\.git(?:\/|$)|wp-admin|wp-login|phpmyadmin|server-status|etc\/passwd)|(?:\.\.[/\\])|(?:union\s+select|<script)/i.test(decoded);
}
export class RequestMonitor {
  private buckets=new Map<string,{count:number;end:number}>();
  private overflow={count:0,end:0};
  private lastLogFailure=0;
  constructor(readonly store: OperationsStore,private limits={general:240,auth:10,telemetry:60},private now:()=>number=Date.now){}
  private take(key:string,limit:number){
    const now=this.now();let entry=this.buckets.get(key);
    if(!entry||entry.end<=now){
      if(this.buckets.size>=5000)for(const [id,value] of this.buckets)if(value.end<=now)this.buckets.delete(id);
      entry={count:0,end:now+60000};this.buckets.delete(key);
      if(this.buckets.size<5000)this.buckets.set(key,entry);
      else {if(this.overflow.end<=now)this.overflow={count:0,end:now+60000};entry=this.overflow;limit=Math.min(limit,this.limits.general);}
    }
    // Keep bounded state; overflow shares a limiter instead of evicting an attacker's live counter.
    entry.count++;return {allowed:entry.count<=limit,retry:Math.max(1,Math.ceil((entry.end-now)/1000))};
  }
  safe(operation:()=>void){
    try{operation();}catch{this.store.markDegraded();if(this.now()-this.lastLogFailure>60000){process.stderr.write('Operations logging unavailable. Check database/disk permissions.\n');this.lastLogFailure=this.now();}}
  }
  async handle(request:Request,context:RequestContext,user:AdminSession|null,run:()=>Promise<Response>):Promise<Response>{
    const started=performance.now(),id=randomUUID(),url=new URL(request.url),path=url.pathname.replace(/\/$/,''),route=monitoredRoute(path);
    // Peer identity comes from the transport, never from caller-controlled forwarding headers.
    const source=this.store.pseudonym(context.peerAddress||'unknown-peer');
    const lane=/\/(login|setup)$/.test(path)?'auth':path==='/api/public/v1/events'?'telemetry':'general';
    const rate=this.take(`${source}:${lane}`,this.limits[lane]);
    let response:Response;
    if(!rate.allowed)response=Response.json({error:{code:'RATE_LIMITED',message:`Quá nhiều request. Thử lại sau ${rate.retry} giây.`}},{status:429,headers:{'Retry-After':String(rate.retry),'Cache-Control':'no-store'}});
    else if(Number(request.headers.get('content-length'))>requestByteLimit(path))response=Response.json({error:{code:'PAYLOAD_TOO_LARGE',message:'Request vượt kích thước cho phép.'}},{status:413,headers:{'Cache-Control':'no-store'}});
    else try{response=await run();}catch{response=Response.json({error:{code:'SERVER_ERROR',message:'Không xử lý được yêu cầu.'}},{status:500});}
    response.headers.set('X-Request-ID',id);response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Referrer-Policy','same-origin');
    let code='';if(response.status>=400&&response.headers.get('content-type')?.includes('json'))try{code=(await response.clone().json()).error?.code||'';}catch{/* response body is not diagnostic data */}
    this.safe(()=>{
      this.store.request({id,route,method:['GET','POST','OPTIONS','HEAD','PUT','PATCH','DELETE'].includes(request.method)?request.method:'OTHER',status:response.status,duration:Math.max(0,Math.round(performance.now()-started)),source,actor:user?.userId});
      if(isProbe(path))this.store.signal('path_probe',source,route,id);
      if(response.status===429)this.store.signal('rate_limited',source,route,id);
      else if(path==='/api/admin/v1/login'&&response.status===401)this.store.signal('login_failed',source,route,id);
      else if(response.status===401&&path.startsWith('/api/admin/'))this.store.signal('unauthorized',source,route,id);
      if(response.status===403&&code==='ORIGIN_BLOCKED')this.store.signal('origin_blocked',source,route,id);
      if(response.status>=500)this.store.signal('server_error',source,route,id);
      if(response.status===413)this.store.signal('oversized',source,route,id);
      if(response.status===422&&['INVALID_JSON','INVALID_TELEMETRY'].includes(code))this.store.signal('invalid_payload',source,route,id);
    });
    return response;
  }
}
