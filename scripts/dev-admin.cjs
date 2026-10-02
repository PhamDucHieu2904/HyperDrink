'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS demo launcher. */
const { spawn }=require('node:child_process');
const port=process.env.ADMIN_WEB_PORT||'3100';
const storefrontPort=process.env.STOREFRONT_WEB_PORT||'3000';
process.env.ADMIN_ALLOWED_ORIGINS ||= [...new Set([port,storefrontPort])].flatMap(value=>[`http://localhost:${value}`,`http://127.0.0.1:${value}`]).join(',');
const api=spawn(process.execPath,[require.resolve('./admin-server.cjs')],{stdio:'inherit',windowsHide:true,env:process.env});
const web=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--port',port,'--hostname','127.0.0.1'],{stdio:'inherit',windowsHide:true,env:{...process.env,ADMIN_DEMO:'true'}});
process.stdout.write(`\nVINUT Admin: http://localhost:${port}/admin\n`);
let stopping=false;
function stop(){if(stopping)return;stopping=true;api.kill();web.kill();}
api.on('exit',stop);web.on('exit',stop);
for(const event of ['SIGINT','SIGTERM'])process.on(event,stop);
