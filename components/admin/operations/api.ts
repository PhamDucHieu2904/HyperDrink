import { publicUrl } from '@/lib/public-url';
export function operationUrl(endpoint:string){return `${(process.env.NEXT_PUBLIC_ADMIN_API_URL||publicUrl('/')).replace(/\/$/,'')}/api/admin/v1/operations/${endpoint}`;}
export async function operationRequest<T>(endpoint:string,options:{body?:unknown;signal?:AbortSignal}={}):Promise<T>{
  const response=await fetch(operationUrl(endpoint),{credentials:'include',cache:'no-store',signal:options.signal,...(options.body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(options.body)}:{})});
  const payload=await response.json();
  if(!response.ok)throw new Error(payload.error?.message||'Không tải được dữ liệu vận hành.');
  return payload.data;
}
