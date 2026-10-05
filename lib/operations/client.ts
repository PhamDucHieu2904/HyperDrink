import { publicUrl } from '@/lib/public-url';
import type { Device, UsageBatch, UsageEvent, UsageEventName } from './contracts';
import { LANGUAGE_STORAGE_KEY, resolveLocale } from '@/lib/i18n/catalog';

export function telemetryEndpoint() {
  const explicit=process.env.NEXT_PUBLIC_TELEMETRY_URL;
  if(explicit){try{const url=new URL(explicit);if(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))return url.href;}catch{/* invalid configuration disables collection */}return '';}
  return process.env.NEXT_PUBLIC_TELEMETRY_MODE==='disabled'?'':publicUrl('/api/public/v1/events');
}
export interface TrackingEnvironment {
  now:()=>number; uuid:()=>string; storage:Pick<Storage,'getItem'|'setItem'>; disabled:()=>boolean;
  device:()=>Device; send:(batch:UsageBatch)=>Promise<boolean>;
}
export class UsageTracker {
  private events:{event:UsageEvent;sessionId:string;device:Device;locale:string}[]=[];
  private inFlight=false;
  private sessionId='';
  private pageTracked=false;
  private locale='en';
  constructor(private environment:TrackingEnvironment){}
  setLocale(locale:string){this.locale=locale;}
  track(name:UsageEventName,target?:string){
    if(this.environment.disabled())return;
    const now=this.environment.now();
    try{
      const saved=JSON.parse(this.environment.storage.getItem('vinut-analytics-session')||'null');
      if(!saved||!Number.isFinite(saved.time)||now-saved.time>30*60000||!/^[a-f0-9-]{36}$/i.test(saved.id)){this.sessionId=this.environment.uuid();this.pageTracked=false;}
      else this.sessionId=saved.id;
      this.environment.storage.setItem('vinut-analytics-session',JSON.stringify({id:this.sessionId,time:now}));
    }catch{if(!this.sessionId)this.sessionId=this.environment.uuid();}
    if(name==='page_view'&&this.pageTracked)return;
    if(name==='page_view')this.pageTracked=true;
    this.events.push({event:{id:this.environment.uuid(),name,...(target&&/^[a-zA-Z0-9_-]{1,100}$/.test(target)?{target}:{})},sessionId:this.sessionId,device:this.environment.device(),locale:this.locale});
    if(this.events.length>100)this.events.splice(0,this.events.length-100);
  }
  async flush(){
    if(this.inFlight||!this.events.length)return;
    if(this.environment.disabled()){this.events=[];return;}
    this.inFlight=true;
    const first=this.events[0];
    let size=0;while(size<this.events.length&&size<20&&this.events[size].sessionId===first.sessionId&&this.events[size].locale===first.locale&&this.events[size].device===first.device)size++;
    const events=this.events.splice(0,size);
    try{
      if(!await this.environment.send({sessionId:first.sessionId,device:first.device,locale:first.locale,events:events.map(item=>item.event)}))this.events.unshift(...events);
    }catch{this.events.unshift(...events);}
    finally{if(this.events.length>100)this.events.length=100;this.inFlight=false;}
  }
}
let tracker:UsageTracker|null=null;
let mounted=0;
export function startTracking(locale:string){
  if(typeof window==='undefined')return ()=>{};
  const endpoint=telemetryEndpoint();if(!endpoint)return ()=>{};
  if(!tracker)tracker=new UsageTracker({now:Date.now,uuid:()=>crypto.randomUUID(),storage:{getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value)},
    disabled:()=>{try{return navigator.doNotTrack==='1'||(navigator as Navigator&{globalPrivacyControl?:boolean}).globalPrivacyControl===true||localStorage.getItem('vinut-analytics-disabled')==='1';}catch{return navigator.doNotTrack==='1';}},
    device:()=>window.innerWidth<768?'mobile':window.innerWidth<1024?'tablet':'desktop',
    send:async batch=>{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',keepalive:true,body:JSON.stringify(batch)});return response.ok||response.status>=400&&response.status<500;},
  });
  let initialLocale=locale;try{initialLocale=resolveLocale(localStorage.getItem(LANGUAGE_STORAGE_KEY));}catch{/* current UI locale remains the fallback */}
  mounted++;tracker.setLocale(initialLocale);tracker.track('page_view');
  const timer=window.setInterval(()=>void tracker?.flush(),2500);
  const flush=()=>{if(document.visibilityState==='hidden')void tracker?.flush();};
  const unload=()=>void tracker?.flush();document.addEventListener('visibilitychange',flush);window.addEventListener('pagehide',unload);
  return()=>{mounted--;window.clearInterval(timer);document.removeEventListener('visibilitychange',flush);window.removeEventListener('pagehide',unload);void tracker?.flush();};
}
export function trackingLocale(locale:string){tracker?.setLocale(locale);}
export function trackUsage(name:UsageEventName,target?:string){if(mounted>0)tracker?.track(name,target);}
