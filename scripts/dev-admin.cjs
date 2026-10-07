'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS demo launcher. */
const { spawn }=require('node:child_process');
const http=require('node:http');
const port=process.env.ADMIN_WEB_PORT||'3100';
const storefrontPort=process.env.STOREFRONT_WEB_PORT||'3000';
process.env.ADMIN_ALLOWED_ORIGINS ||= [...new Set([port,storefrontPort])].flatMap(value=>[`http://localhost:${value}`,`http://127.0.0.1:${value}`]).join(',');
const apiPort=process.env.ADMIN_API_PORT||'3010';
const children=[];
let stopping=false;
function stop(){if(stopping)return;stopping=true;for(const child of children)child.kill();}
for(const event of ['SIGINT','SIGTERM'])process.on(event,stop);
function probe(targetPort,path){
  return new Promise((resolve,reject)=>{
    const request=http.get({hostname:'127.0.0.1',port:targetPort,path},response=>{
      let body='';response.setEncoding('utf8');response.on('data',chunk=>{if(body.length<100000)body+=chunk;});
      response.on('end',()=>resolve({status:response.statusCode,body}));response.on('error',reject);
    });
    request.setTimeout(30000,()=>request.destroy(new Error(`Port ${targetPort} did not respond.`)));
    request.on('error',error=>error.code==='ECONNREFUSED'?resolve(null):reject(error));
  });
}
function matchesApi(response){try{return response.status===200&&JSON.parse(response.body).data.backend==='local-sqlite';}catch{return false;}}
function matchesWeb(response){return response.status===200&&/vinut/i.test(response.body);}
function launch(args,env){
  const child=spawn(process.execPath,args,{stdio:'inherit',windowsHide:true,env});children.push(child);
  child.on('error',error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;stop();});
  child.on('exit',code=>{if(!stopping){process.exitCode=code||1;stop();}});
}
async function ready(targetPort,path,matches){
  const deadline=Date.now()+60000;
  while(!stopping&&Date.now()<deadline){const response=await probe(targetPort,path);if(response&&matches(response))return;await new Promise(resolve=>setTimeout(resolve,500));}
  throw new Error(`Could not start VINUT on port ${targetPort}. Check the error above.`);
}
async function main(){
  const api=await probe(apiPort,'/api/admin/v1/session');
  const web=await probe(port,'/admin');
  if(api&&!matchesApi(api))throw new Error(`Port ${apiPort} is used by another service. Close that service or set ADMIN_API_PORT.`);
  if(web&&!matchesWeb(web))throw new Error(`Port ${port} is used by another website. Close that service or set ADMIN_WEB_PORT.`);
  if(api)process.stdout.write(`Using running VINUT API on port ${apiPort}.\n`);
  // The API's TypeScript loader runs once per process. Restart loaded modules
  // when schemas change, just as Next reloads the admin UI during development.
  else launch(['--watch','--watch-preserve-output',require.resolve('./admin-server.cjs')],process.env);
  if(web)process.stdout.write(`Using running VINUT Admin on port ${port}.\n`);
  else launch([require.resolve('next/dist/bin/next'),'dev','--port',port,'--hostname','127.0.0.1'],{...process.env,ADMIN_DEMO:'true',ADMIN_API_URL:`http://127.0.0.1:${apiPort}`});
  await ready(apiPort,'/api/admin/v1/session',matchesApi);
  await ready(port,'/admin',matchesWeb);
  process.stdout.write(`\nVINUT Admin ready: http://localhost:${port}/admin\nKeep this window open while using Admin.\n`);
  if(process.argv.includes('--open')){
    const opener=spawn('cmd.exe',['/d','/c','start','',`http://localhost:${port}/admin`],{windowsHide:true,stdio:'ignore'});
    opener.on('error',()=>process.stderr.write('Open the Admin URL above in your browser.\n'));
  }
}
main().catch(error=>{process.stderr.write(`\n[ERROR] ${error.message}\n`);process.exitCode=1;stop();});
