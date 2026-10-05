'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS demo entry point. */
require('./register-admin-typescript.cjs');
const http = require('node:http');
const { LocalCatalogRepository } = require('../lib/server/local-repository.ts');
const { createAdminHandler } = require('../lib/server/admin-api.ts');
const { OperationsStore } = require('../lib/server/operations.ts');
const { RequestMonitor, requestByteLimit, trustedPeerAddress } = require('../lib/server/request-monitor.ts');
const { exportPublishedCatalog } = require('./export-public-catalog.cjs');
const port = Number(process.env.ADMIN_API_PORT || 3010);
const host = '127.0.0.1';
const repository = new LocalCatalogRepository();
const syncPublicCatalog = () => exportPublishedCatalog({ dataDir: repository.directory });
const monitor = new RequestMonitor(new OperationsStore(repository.database));
const handle = createAdminHandler(repository, { allowedOrigins: process.env.ADMIN_ALLOWED_ORIGINS?.split(',').map(value=>value.trim()), dataDir: repository.directory, syncPublicCatalog, monitor });
const trustedProxies=new Set((process.env.ADMIN_TRUSTED_PROXIES||'').split(',').map(value=>value.trim()).filter(Boolean));
const server = http.createServer(async (incoming, outgoing) => {
  try {
    const context={peerAddress:trustedPeerAddress(incoming.socket.remoteAddress||'unknown',String(incoming.headers['x-forwarded-for']||''),trustedProxies)};
    const chunks=[];let size=0;
    const limit=requestByteLimit(new URL(incoming.url||'/',`http://localhost:${port}`).pathname);
    if(Number(incoming.headers['content-length'])>limit){
      const rejectedMethod=incoming.method||'POST';
      const rejected=await handle(new Request(`http://localhost:${port}${incoming.url}`,{method:rejectedMethod,headers:{Origin:String(incoming.headers.origin||''),'Content-Length':String(incoming.headers['content-length'])},...(!['GET','HEAD'].includes(rejectedMethod)?{body:'{}'}:{})}),context);
      outgoing.writeHead(rejected.status,{...Object.fromEntries(rejected.headers),Connection:'close'});outgoing.end(Buffer.from(await rejected.arrayBuffer()));return;
    }
    for await (const chunk of incoming) { size+=chunk.length; if(size>limit){
      const rejectedMethod=incoming.method||'POST';
      const rejected=await handle(new Request(`http://localhost:${port}${incoming.url}`,{method:rejectedMethod,headers:{Origin:String(incoming.headers.origin||''),'Content-Length':String(size)},...(!['GET','HEAD'].includes(rejectedMethod)?{body:'{}'}:{})}),context);
      outgoing.writeHead(rejected.status,Object.fromEntries(rejected.headers));outgoing.end(Buffer.from(await rejected.arrayBuffer()));return;
    } chunks.push(chunk); }
    const body=Buffer.concat(chunks), method=incoming.method||'GET';
    const headers=new Headers(); for (const [key,value] of Object.entries(incoming.headers)) if(value) headers.set(key,Array.isArray(value)?value.join(','):value);
    const request=new Request(`http://localhost:${port}${incoming.url}`,{method,headers,...(!['GET','HEAD'].includes(method)?{body,duplex:'half'}:{})});
    const response=await handle(request,context); outgoing.writeHead(response.status,Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500,{'Content-Type':'application/json'}); outgoing.end(JSON.stringify({error:{code:'SERVER_ERROR',message:'Không xử lý được yêu cầu.'}})); }
});
server.headersTimeout=15000;
server.requestTimeout=60000;
server.keepAliveTimeout=5000;
server.maxHeadersCount=100;
async function start() {
  if (await repository.readActiveRelease()) {
    try { syncPublicCatalog(); }
    catch { process.stderr.write('Public catalog export failed. The previous standalone snapshot is retained; run npm run catalog:export after checking media files.\n'); }
  }
  server.listen(port,host,()=>process.stdout.write(`VINUT Admin API: http://localhost:${port}\nData: local SQLite; bind: loopback only\n`));
}
void start();
for (const event of ['SIGINT','SIGTERM']) process.on(event,()=>server.close(()=>{repository.close();process.exit(0);}));
