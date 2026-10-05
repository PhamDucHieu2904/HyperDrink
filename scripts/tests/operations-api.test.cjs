/* eslint-disable @typescript-eslint/no-require-imports -- Test actual authenticated HTTP handlers with isolated data. */
require('../register-admin-typescript.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {LocalCatalogRepository}=require('../../lib/server/local-repository.ts');
const {createAdminHandler}=require('../../lib/server/admin-api.ts');
async function fixture(callback){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vinut-operations-'));const repository=new LocalCatalogRepository(directory);const origin='http://127.0.0.1:3000';const handle=createAdminHandler(repository,{allowedOrigins:[origin],dataDir:directory});const owner=repository.bootstrapOwner('owner@example.test','demo-operations-password');const cookie=`vinut_admin_session=${repository.createSession(owner)}`;const request=async(endpoint,{body,authenticated=true,requestOrigin=origin,peer='192.0.2.5',method=body===undefined?'GET':'POST'}={})=>{const response=await handle(new Request(`http://127.0.0.1:3010${endpoint}`,{method,headers:{Origin:requestOrigin,...(authenticated?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{peerAddress:peer});return{response,payload:await response.json()};};try{await callback({repository,request,owner});}finally{repository.close();fs.rmSync(directory,{recursive:true,force:true});}}
test('anonymous collection is allowed only for approved origins; reports and logs require login',async()=>fixture(async({request})=>{
  const body={sessionId:randomUUID(),device:'mobile',locale:'en',events:[{id:randomUUID(),name:'page_view'},{id:randomUUID(),name:'search_open'}]};
  assert.equal((await request('/api/public/v1/events',{body,authenticated:false})).payload.data.accepted,2);
  assert.equal((await request('/api/public/v1/events',{body,authenticated:false})).payload.data.accepted,0);
  assert.equal((await request('/api/public/v1/events',{body,authenticated:false,requestOrigin:'https://blocked.example'})).response.status,403);
  for(const endpoint of ['analytics','security','logs'])assert.equal((await request(`/api/admin/v1/operations/${endpoint}`,{authenticated:false})).response.status,401);
  const report=await request('/api/admin/v1/operations/analytics?scope=local&device=mobile&days=7');assert.equal(report.payload.data.totals.views,1);assert.equal(report.payload.data.features[0].name,'search_open');assert.equal((await request('/api/public/v1/events',{body:{...body,events:[{id:randomUUID(),name:'wrong-event'}]},authenticated:false})).response.status,422);
}));
test('failed login alerts, acknowledgement permissions and safe exported logs work over the real API',async()=>fixture(async({request,repository,owner})=>{
  for(let i=0;i<5;i++)assert.equal((await request('/api/admin/v1/login',{body:{email:'not-an-account@example.test',password:'never-retain-this'},authenticated:false,peer:'192.0.2.10'})).response.status,401);
  let security=(await request('/api/admin/v1/operations/security')).payload.data;assert.equal(security.totals.failedLogins,5);assert.equal(security.totals.openAlerts,1);const id=security.alerts[0].id;
  const exported=await request('/api/admin/v1/operations/logs?kind=security&export=1');assert.match(exported.response.headers.get('Content-Disposition'),/attachment; filename="vinut-logs-/);assert.ok(!JSON.stringify(exported.payload).includes('never-retain-this'));assert.ok(!JSON.stringify(exported.payload).includes('not-an-account@example.test'));assert.ok(!JSON.stringify(exported.payload).includes('192.0.2.10'));
  repository.database.prepare("UPDATE admin_users SET role='editor' WHERE id=?").run(owner.userId);assert.equal((await request('/api/admin/v1/operations/acknowledge',{body:{id}})).response.status,403);repository.database.prepare("UPDATE admin_users SET role='owner' WHERE id=?").run(owner.userId);
  assert.equal((await request('/api/admin/v1/operations/acknowledge',{body:{id}})).response.status,200);security=(await request('/api/admin/v1/operations/security')).payload.data;assert.equal(security.totals.openAlerts,0);
  assert.equal((await request('/api/admin/v1/operations/logs?kind=security&days=1000')).response.status,422);
}));
test('login flood is refused before expensive authentication and retains CORS and retry headers',async()=>fixture(async({request})=>{
  for(let i=0;i<10;i++)assert.equal((await request('/api/admin/v1/login',{body:{email:`fake-${i}@example.test`,password:'test-only-password'},authenticated:false,peer:'192.0.2.20'})).response.status,401);
  const result=await request('/api/admin/v1/login',{body:{email:'another@example.test',password:'test-only-password'},authenticated:false,peer:'192.0.2.20'});
  assert.equal(result.response.status,429);assert.ok(Number(result.response.headers.get('Retry-After'))>0);assert.equal(result.response.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:3000');assert.ok(result.response.headers.get('X-Request-ID'));assert.equal((await request('/api/admin/v1/operations/security')).payload.data.alerts.filter(row=>row.type==='rate_limited').length,1);
}));
