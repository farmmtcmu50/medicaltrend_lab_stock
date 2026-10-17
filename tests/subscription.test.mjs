import {test,after,before} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {addMonths,digest} from '../subscription/src/security.js';
const require=createRequire(import.meta.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=require('miniflare'),esbuild=require('esbuild');
let mf,db,aDb,bDb,ownerCookie,tenantA,tenantB;
const origin='https://control.example';
const password='a-secure-test-password-2026';
const token='test-setup-token-not-used-in-production';
async function request(path,{method='GET',body,cookie=ownerCookie,from=origin}={}){
 const response=await mf.dispatchFetch(origin+path,{method,headers:{...(cookie?{cookie}:{}),...(from?{origin:from}:{}),'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function tenantRequest(name,path,{method='GET',body,cookie,from}={}){
 const url='https://'+name+'.example';
 const response=await mf.dispatchFetch(url+path,{method,headers:{...(cookie?{cookie}:{}),origin:from||url,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function sql(db,source){for(const statement of source.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();}
before(async()=>{
 await mkdir(resolve('work'),{recursive:true});
 const bundle=async file=>(await esbuild.build({entryPoints:[file],bundle:true,write:false,format:'esm',platform:'browser',mainFields:['browser','module','main'],conditions:['workerd','browser'],logLevel:'silent'})).outputFiles[0].text;
 const [control,stock]=await Promise.all([bundle('subscription/src/index.js'),bundle('src/index.js')]);
 const tenant=(name,tid,serviceToken)=>({name,routes:[name+'.example/*'],modules:[{type:'ESModule',path:'worker.js',contents:stock}],compatibilityDate:'2026-08-31',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:name+'-db'},serviceBindings:{SUBSCRIPTIONS:'control'},bindings:{TENANT_ID:tid,SESSION_SECRET:'same-secret-for-explicit-tenant-boundary-test',SUBSCRIPTION_TOKEN:serviceToken,TENANT_SETUP_TOKEN:'setup-'+name,SESSION_COOKIE:'stock_session'}});
 mf=new Miniflare(convertV4MiniflareOptions({defaultPersistRoot:resolve('work/test-runtime-'+randomUUID()),workers:[{name:'control',routes:['control.example/*'],modules:[{type:'ESModule',path:'worker.js',contents:control}],compatibilityDate:'2026-08-31',d1Databases:{CONTROL_DB:'control-db'},bindings:{ADMIN_EMAIL:'chanat@medicaltrend.co.th',SETUP_TOKEN:token}},tenant('tenant-a','tenant-a','service-a'),tenant('tenant-b','tenant-b','service-b')]}));
 db=await mf.getD1Database('CONTROL_DB','control');aDb=await mf.getD1Database('DB','tenant-a');bDb=await mf.getD1Database('DB','tenant-b');
 for(const file of (await readdir('subscription/migrations')).sort())await sql(db,await readFile('subscription/migrations/'+file,'utf8'));
 for(const file of (await readdir('migrations')).sort()){const content=await readFile('migrations/'+file,'utf8');await sql(aDb,content);await sql(bDb,content);}
});
after(async()=>{await mf?.dispose();});
test('calendar renewal clamps month end and preserves leap years',()=>{
 assert.equal(addMonths('2026-01-31T12:00:00.000Z',1),'2026-02-28T12:00:00.000Z');
 assert.equal(addMonths('2028-01-31T12:00:00.000Z',1),'2028-02-29T12:00:00.000Z');
});
test('control API requires owner setup token and rejects cross-origin writes',async()=>{
 assert.equal((await request('/api/tenants',{cookie:null})).status,401);
 assert.equal((await request('/api/setup',{method:'POST',cookie:null,from:'https://evil.example',body:{token,password}})).status,403);
 assert.equal((await request('/api/setup',{method:'POST',cookie:null,body:{token:'wrong',password}})).status,403);
 assert.equal((await request('/api/setup',{method:'POST',cookie:null,body:{token,password:'1111'}})).status,400);
 assert.equal((await request('/api/setup',{method:'POST',cookie:null,body:{token,password}})).status,200);
 assert.equal((await request('/api/setup',{method:'POST',cookie:null,body:{token,password}})).status,409);
 const login=await request('/api/login',{method:'POST',cookie:null,body:{email:'chanat@medicaltrend.co.th',password}});
 assert.equal(login.status,200);ownerCookie=login.cookie;assert.ok(ownerCookie);
 assert.equal((await request('/api/login',{method:'POST',cookie:null,body:{email:'admin@customer.example',password}})).status,401);
});
test('owner can create independent customers and cannot reuse their slug',async()=>{
 const input={name:'Customer A',slug:'customer-a',contact_email:'a@example.com',plan_id:'standard',trial_days:14};
 const created=await request('/api/tenants',{method:'POST',body:input});assert.equal(created.status,201);assert.equal(created.data.tenant.provision_status,'pending');assert.equal('service_token_hash' in created.data.tenant,false);
 assert.equal((await request('/api/tenants',{method:'POST',body:input})).status,409);
 assert.equal((await request('/api/tenants',{method:'POST',body:{...input,slug:'invalid/slug'}})).status,400);
 const until='2026-12-31T00:00:00.000Z';
 for(const [tid,slug,name,secret]of [['tenant-a','tenant-a','A','service-a'],['tenant-b','tenant-b','B','service-b']]){
  await db.prepare(`INSERT INTO tenants(id,slug,name,contact_email,plan_id,status,expires_at,provision_status,database_id,database_name,service_token_hash,created_at,updated_at) VALUES (?,?,?,?,'standard','active',?,'ready',?,?,?,?,?)`).bind(tid,slug,name,name+'@example.com',until,tid+'-db',tid+'-db',await digest(secret),'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z').run();
 }
 tenantA=await db.prepare("SELECT * FROM tenants WHERE id='tenant-a'").first();tenantB=await db.prepare("SELECT * FROM tenants WHERE id='tenant-b'").first();
});
test('customer passwords have no defaults and sessions are bound to their tenant',async()=>{
 assert.equal((await tenantRequest('tenant-a','/api/login',{method:'POST',body:{username:'admin',password:'1111'}})).status,401);
 assert.equal((await aDb.prepare('SELECT COUNT(*) AS n FROM users').first()).n,0);
 for(const name of ['tenant-a','tenant-b'])assert.equal((await tenantRequest(name,'/api/tenant/setup',{method:'POST',body:{token:'setup-'+name,password}})).status,200);
 assert.equal((await tenantRequest('tenant-a','/api/tenant/setup',{method:'POST',body:{token:'setup-tenant-a',password}})).status,409);
 const login=await tenantRequest('tenant-a','/api/login',{method:'POST',body:{username:'admin',password}});assert.equal(login.status,200);
 assert.equal((await tenantRequest('tenant-a','/api/me',{cookie:login.cookie})).status,200);
 assert.equal((await tenantRequest('tenant-b','/api/me',{cookie:login.cookie})).status,401);
 assert.equal((await request('/api/me',{cookie:login.cookie})).status,401);
});
test('items, prices, units and backups stay in the selected customer database',async()=>{
 const insert=async(db,name,price,main,sub)=>db.prepare(`INSERT INTO items(item_id,reagent_name,unit_price,main_unit,sub_unit,created_at,updated_at) VALUES ('shared-id',?,?,?,?,?,?)`).bind(name,price,main,sub,new Date().toISOString(),new Date().toISOString()).run();
 await insert(aDb,'A reagent',3000,'กล่อง','ขวด');await insert(bDb,'B reagent',800,'ชุด','แผ่น');
 for(const [name,expected,price,main]of [['tenant-a','A reagent',3000,'กล่อง'],['tenant-b','B reagent',800,'ชุด']]){
  const login=await tenantRequest(name,'/api/login',{method:'POST',body:{username:'admin',password}});
  const items=await tenantRequest(name,'/api/items',{cookie:login.cookie});assert.equal(items.status,200);assert.equal(items.data.rows[0].reagent_name,expected);assert.equal(items.data.rows[0].unit_price,price);assert.equal(items.data.rows[0].main_unit,main);
  const backup=await tenantRequest(name,'/api/backup',{cookie:login.cookie});assert.equal(backup.status,200);const serialized=JSON.stringify(backup.data);assert.ok(serialized.includes(expected));assert.ok(!serialized.includes(name==='tenant-a'?'B reagent':'A reagent'));
 }
});
test('expiry permits reading/export and blocks writes; suspension blocks access; control faults fail closed',async()=>{
 const login=await tenantRequest('tenant-a','/api/login',{method:'POST',body:{username:'admin',password}});
 await db.prepare("UPDATE tenants SET expires_at='2020-01-01T00:00:00.000Z' WHERE id='tenant-a'").run();
 assert.equal((await tenantRequest('tenant-a','/api/items',{cookie:login.cookie})).status,200);
 assert.equal((await tenantRequest('tenant-a','/api/backup',{cookie:login.cookie})).status,200);
 assert.equal((await tenantRequest('tenant-a','/api/items',{method:'POST',cookie:login.cookie,body:{}})).status,402);
 assert.equal((await tenantRequest('tenant-a','/api/restore',{method:'POST',cookie:login.cookie,body:{}})).status,402);
 await db.prepare("UPDATE tenants SET status='suspended' WHERE id='tenant-a'").run();
 assert.equal((await tenantRequest('tenant-a','/api/me',{cookie:login.cookie})).status,403);
 await db.prepare("UPDATE tenants SET status='active',service_token_hash='wrong' WHERE id='tenant-a'").run();
 assert.equal((await tenantRequest('tenant-a','/api/me',{cookie:login.cookie})).status,503);
 await db.prepare("UPDATE tenants SET service_token_hash=? WHERE id='tenant-a'").bind(await digest('service-a')).run();
});
test('manual payments are idempotent and optimistic concurrency prevents double extensions',async()=>{
 const tid=randomUUID();await db.prepare(`INSERT INTO tenants(id,slug,name,contact_email,plan_id,status,expires_at,provision_status,created_at,updated_at) VALUES (?,'billing-test','Billing','billing@example.com','standard','trial','2026-01-01T00:00:00.000Z','ready','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`).bind(tid).run();
 const payment={months:1,amount_satang:99000,reference:'BANK-TEST-001',plan_id:'standard',version:0,request_key:randomUUID()};
 const first=await request(`/api/tenants/${tid}/renew`,{method:'POST',body:payment});assert.equal(first.status,200);assert.equal(first.data.tenant.status,'active');assert.equal(first.data.tenant.version,1);
 const repeated=await request(`/api/tenants/${tid}/renew`,{method:'POST',body:payment});assert.equal(repeated.status,200);assert.equal(repeated.data.duplicate,true);
 const stale=await request(`/api/tenants/${tid}/renew`,{method:'POST',body:{...payment,request_key:randomUUID()}});assert.equal(stale.status,409);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM payments WHERE tenant_id=?').bind(tid).first()).n,1);
 const competing=await Promise.all([1,2].map(n=>request(`/api/tenants/${tid}/renew`,{method:'POST',body:{...payment,version:1,request_key:randomUUID(),reference:'race-'+n}})));
 assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM payments WHERE tenant_id=?').bind(tid).first()).n,2);
 const suspend=await request(`/api/tenants/${tid}/status`,{method:'POST',body:{status:'suspended',reason:'test hold',version:2}});assert.equal(suspend.status,200);
 assert.equal((await request(`/api/tenants/${tid}/renew`,{method:'POST',body:{...payment,version:3,request_key:randomUUID()}})).status,409);
});
test('package prices persist and stale status writes leave no misleading audit event',async()=>{
 assert.equal((await request('/api/plans/standard',{method:'PUT',body:{name:'Standard',monthly_price_satang:99000,description:'Monthly subscription'}})).status,200);
 assert.equal((await request('/api/plans')).data.rows.find(p=>p.id==='standard').monthly_price_satang,99000);
 assert.equal((await request('/api/plans/standard',{method:'PUT',body:{name:'Standard',monthly_price_satang:-1}})).status,400);
 const t=(await request('/api/tenants')).data.rows.find(t=>t.slug==='billing-test');
 const before=(await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE tenant_id=? AND action='STATUS_CHANGED'").bind(t.id).first()).n;
 assert.equal((await request(`/api/tenants/${t.id}/status`,{method:'POST',body:{status:'suspended',reason:'stale test',version:t.version-1}})).status,409);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE tenant_id=? AND action='STATUS_CHANGED'").bind(t.id).first()).n,before);
});
test('changing the owner password revokes all prior sessions and logout clears the new session',async()=>{
 const changed=await request('/api/password',{method:'PUT',body:{current_password:password,password:password+'-new'}});assert.equal(changed.status,200);
 assert.equal((await request('/api/me')).status,401);
 const login=await request('/api/login',{method:'POST',cookie:null,body:{email:'chanat@medicaltrend.co.th',password:password+'-new'}});assert.equal(login.status,200);ownerCookie=login.cookie;
 assert.equal((await request('/api/logout',{method:'POST',body:{}})).status,200);
 assert.equal((await request('/api/me')).status,401);
});

test('indexed QR scans preserve FEFO, mixed-case codes and partial packages', async () => {
 await db.prepare("UPDATE tenants SET expires_at='2099-01-01T00:00:00.000Z' WHERE id='tenant-a'").run();
 const login=await tenantRequest('tenant-a','/api/login',{method:'POST',body:{username:'admin',password}});
 const cookie=login.cookie;
 const item=(await aDb.prepare('SELECT item_id FROM items LIMIT 1').first()).item_id;
 await aDb.prepare("INSERT INTO package_barcodes(package_barcode,item_id,reagent_name,expiry_date,received_at) VALUES ('SCAN-PACK',?,'Scan test','2028-02-01','2026-01-01')").bind(item).run();
 for(const [code,expiry,parent] of [['SCAN-OLD','2028-01-01',''],['SCAN-ONE','2028-02-01','SCAN-PACK'],['SCAN-TWO','2028-02-01','SCAN-PACK']]) {
  await aDb.prepare('INSERT INTO stock_units(barcode,item_id,reagent_name,expiry_date,received_at,parent_barcode) VALUES (?,?,?,?,?,?)').bind(code,item,'Scan test',expiry,'2026-01-01',parent).run();
 }
 const preview=await tenantRequest('tenant-a','/api/consume/preview',{method:'POST',cookie,body:{barcode:'scan-pack'}});
 assert.equal(preview.status,200);assert.equal(preview.data.target.quantity_sub,2);assert.ok(preview.data.warnings.length);
 assert.equal((await tenantRequest('tenant-a','/api/consume',{method:'POST',cookie,body:{barcode:'scan-pack',package_quantity:1}})).status,409);
 const partial=await tenantRequest('tenant-a','/api/consume',{method:'POST',cookie,body:{barcode:'scan-pack',package_quantity:1,confirm_fefo:true}});
 assert.equal(partial.status,200);assert.equal(partial.data.barcode,'SCAN-PACK');assert.equal(partial.data.remaining_sub,1);
 const child=await aDb.prepare("SELECT barcode FROM stock_units WHERE parent_barcode='SCAN-PACK' AND status='IN_STOCK'").first();
 const last=await tenantRequest('tenant-a','/api/consume',{method:'POST',cookie,body:{barcode:child.barcode.toLowerCase(),confirm_fefo:true}});
 assert.equal(last.status,200);assert.equal(last.data.parent_barcode,'SCAN-PACK');assert.equal(last.data.remaining_sub,0);
 const single=await tenantRequest('tenant-a','/api/consume',{method:'POST',cookie,body:{barcode:'scan-old'}});
 assert.equal(single.status,200);assert.equal(single.data.remaining_sub,0);
 const plan=await aDb.prepare("EXPLAIN QUERY PLAN SELECT * FROM stock_units WHERE lower(barcode)=lower(?) AND status='IN_STOCK'").bind('SCAN-OLD').all();
 assert.ok(plan.results.some(row=>row.detail.includes('idx_su_barcode_lower')));
});

test('QR query plan avoids a table scan with 10,000 historical rows', async () => {
 await aDb.prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<10000)
 INSERT INTO stock_units(barcode,item_id,reagent_name,expiry_date,received_at,status)
 SELECT 'HISTORY-'||n,'history','History','2025-01-01','2024-01-01','USED' FROM seq`).run();
 const query="SELECT * FROM stock_units WHERE lower(barcode)=lower(?) AND status='IN_STOCK'";
 const before=await aDb.prepare('EXPLAIN QUERY PLAN '+query.replace('FROM stock_units','FROM stock_units NOT INDEXED')).bind('missing-code').all();
 const after=await aDb.prepare('EXPLAIN QUERY PLAN '+query).bind('missing-code').all();
 console.log('QR query plan:',JSON.stringify({before:before.results,after:after.results}));
 assert.ok(before.results.some(r=>r.detail.includes('SCAN stock_units')));
 assert.ok(after.results.some(r=>r.detail.includes('idx_su_barcode_lower')));
});
