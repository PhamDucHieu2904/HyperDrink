'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS demo entry point. */
require('./register-admin-typescript.cjs');
const http = require('node:http');
const { LocalCatalogRepository } = require('../lib/server/local-repository.ts');
const { createAdminHandler } = require('../lib/server/admin-api.ts');
const port = Number(process.env.ADMIN_API_PORT || 3010);
const host = '127.0.0.1';
const repository = new LocalCatalogRepository();
const handle = createAdminHandler(repository, { allowedOrigins: process.env.ADMIN_ALLOWED_ORIGINS?.split(',').map(value=>value.trim()), dataDir: process.env.ADMIN_DATA_DIR });
const server = http.createServer(async (incoming, outgoing) => {
  try {
    const chunks=[];let size=0;
    for await (const chunk of incoming) { size+=chunk.length; if(size>34*1024*1024){outgoing.writeHead(413);outgoing.end('File quá lớn.');return;} chunks.push(chunk); }
    const body=Buffer.concat(chunks), method=incoming.method||'GET';
    const headers=new Headers(); for (const [key,value] of Object.entries(incoming.headers)) if(value) headers.set(key,Array.isArray(value)?value.join(','):value);
    const request=new Request(`http://localhost:${port}${incoming.url}`,{method,headers,...(!['GET','HEAD'].includes(method)?{body,duplex:'half'}:{})});
    const response=await handle(request); outgoing.writeHead(response.status,Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500,{'Content-Type':'application/json'}); outgoing.end(JSON.stringify({error:{code:'SERVER_ERROR',message:'Không xử lý được yêu cầu.'}})); }
});
server.listen(port,host,()=>process.stdout.write(`VINUT Admin API: http://localhost:${port}\nData: local SQLite; bind: loopback only\n`));
for (const event of ['SIGINT','SIGTERM']) process.on(event,()=>server.close(()=>{repository.close();process.exit(0);}));
