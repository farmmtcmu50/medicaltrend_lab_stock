import {test,after,before} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {addMonths,digest} from '../subscription/src/security.js';
import {SignJWT,exportJWK,generateKeyPair} from 'jose';
const require=createRequire(import.meta.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=require('miniflare'),esbuild=require('esbuild');
let mf,db,aDb,bDb,ownerToken,tenantA,tenantB;
const TEAM='https://medicaltrend.cloudflareaccess.com',AUD='control-aud-test';
const origin='https://control.example';
const password='a-secure-test-password-2026';
let strangerToken;
async function request(path,{method='GET',body,token=ownerToken,cookie,from=origin}={}){
 const response=await mf.dispatchFetch(origin+path,{method,headers:{...(token?{'cf-access-jwt-assertion':token}:{}),...(cookie?{cookie}:{}),...(from?{origin:from}:{}),'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
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
 const key=await generateKeyPair('RS256'),jwks={keys:[{...await exportJWK(key.publicKey),kid:'k1',alg:'RS256'}]};
 const accessToken=email=>new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:'k1'}).setIssuer(TEAM).setAudience(AUD).setIssuedAt().setExpirationTime('1h').sign(key.privateKey);
 ownerToken=await accessToken('chanat@medicaltrend.co.th');strangerToken=await accessToken('admin@customer.example');
 const bundle=async file=>(await esbuild.build({entryPoints:[file],bundle:true,write:false,format:'esm',platform:'browser',mainFields:['browser','module','main'],conditions:['workerd','browser'],logLevel:'silent'})).outputFiles[0].text;
 const [control,stock]=await Promise.all([bundle('subscription/src/index.js'),bundle('src/index.js')]);
 const tenant=(name,tid,serviceToken)=>({name,routes:[name+'.example/*'],modules:[{type:'ESModule',path:'worker.js',contents:stock}],compatibilityDate:'2026-08-31',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:name+'-db'},serviceBindings:{SUBSCRIPTIONS:'control'},bindings:{TENANT_ID:tid,SESSION_SECRET:'same-secret-for-explicit-tenant-boundary-test',SUBSCRIPTION_TOKEN:serviceToken,TENANT_SETUP_TOKEN:'setup-'+name,SESSION_COOKIE:'stock_session'}});
 mf=new Miniflare(convertV4MiniflareOptions({defaultPersistRoot:resolve('work/test-runtime-'+randomUUID()),workers:[{name:'control',routes:['control.example/*'],modules:[{type:'ESModule',path:'worker.js',contents:control}],compatibilityDate:'2026-08-31',d1Databases:{CONTROL_DB:'control-db'},bindings:{ADMIN_EMAIL:'chanat@medicaltrend.co.th',ACCESS_TEAM_DOMAIN:TEAM,ACCESS_AUD:AUD},outboundService:async r=>r.url===TEAM+'/cdn-cgi/access/certs'?Response.json(jwks):new Response('',{status:599})},tenant('tenant-a','tenant-a','service-a'),tenant('tenant-b','tenant-b','service-b')]}));
 db=await mf.getD1Database('CONTROL_DB','control');aDb=await mf.getD1Database('DB','tenant-a');bDb=await mf.getD1Database('DB','tenant-b');
 for(const file of (await readdir('subscription/migrations')).sort())await sql(db,await readFile('subscription/migrations/'+file,'utf8'));
 for(const file of (await readdir('migrations')).sort()){const content=await readFile('migrations/'+file,'utf8');await sql(aDb,content);await sql(bDb,content);}
 for(const database of [aDb,bDb])await database.prepare("INSERT INTO suppliers(supplier_id,name,created_at,updated_at) VALUES('test-supplier','Test Supplier',datetime('now'),datetime('now'))").run();
});
after(async()=>{await mf?.dispose();});
test('calendar renewal clamps month end and preserves leap years',()=>{
 assert.equal(addMonths('2026-01-31T12:00:00.000Z',1),'2026-02-28T12:00:00.000Z');
 assert.equal(addMonths('2028-01-31T12:00:00.000Z',1),'2028-02-29T12:00:00.000Z');
});
test('control API requires an Access identity of the owner and rejects cross-origin writes',async()=>{
 assert.equal((await request('/api/tenants',{token:null})).status,401);
 assert.equal((await request('/api/tenants',{token:strangerToken})).status,403);
 assert.equal((await request('/api/tenants',{method:'POST',from:'https://evil.example',body:{}})).status,403);
 assert.equal((await request('/api/me')).status,200);
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
 assert.equal((await request('/api/me',{token:null,cookie:login.cookie})).status,401);
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
test('control has no password or session endpoints; logout is handled by Access',async()=>{
 for(const path of ['/api/password','/api/login','/api/logout','/api/setup'])assert.equal((await request(path,{method:path==='/api/password'?'PUT':'POST',body:{}})).status,404,path);
 const me=await request('/api/me');assert.equal(me.data.logout_url,'/cdn-cgi/access/logout');assert.equal(me.cookie,undefined);
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

test('optional sub units preserve single-unit stock, conversion, backups and history',async()=>{
 const cookie=(await tenantRequest('tenant-a','/api/login',{method:'POST',body:{username:'admin',password}})).cookie;
 const send=(path,body,method='POST')=>tenantRequest('tenant-a',path,{method,cookie,body});
 const base={supplier_id:'test-supplier',reagent_name:'Single unit',main_unit:'ขวด',has_sub_unit:0,sub_unit:'ignored',sub_per_main:99,main_unit_price:120};
 const added=await send('/api/items',base);assert.equal(added.status,200);
 const id=added.data.item_id;
 let item=await aDb.prepare('SELECT * FROM items WHERE item_id=?').bind(id).first();
 assert.equal(item.has_sub_unit,0);assert.equal(item.sub_unit,'ขวด');assert.equal(item.sub_per_main,1);assert.equal(item.unit_price,120);
 let received=await send('/api/receive',{item_id:id,quantity:3,unit_mode:'main',sticker_mode:'main',lot:'SINGLE',expiry_date:'2028-12-31'});
 assert.equal(received.status,200);assert.equal(received.data.labels.length,3);assert.ok(received.data.labels.every(l=>l.type==='sub'));
 let stock=await aDb.prepare("SELECT COUNT(*) AS qty FROM stock_units WHERE item_id=? AND status='IN_STOCK'").bind(id).first();assert.equal(stock.qty,3);
 const consumed=await send('/api/consume',{barcode:received.data.labels[0].code});assert.equal(consumed.status,200);assert.equal(consumed.data.consumed,1);
 assert.equal((await send('/api/items/'+id,{...base,reagent_name:'Renamed'},'PUT')).status,200);
 assert.equal((await send('/api/items/'+id,{...base,has_sub_unit:1,sub_unit:'Test',sub_per_main:10},'PUT')).status,409);
 const converted=await send('/api/items',{...base,reagent_name:'Converted',has_sub_unit:1,main_unit:'กล่อง',sub_unit:'ขวด',sub_per_main:5,main_unit_price:500});assert.equal(converted.status,200);
 item=await aDb.prepare('SELECT * FROM items WHERE item_id=?').bind(converted.data.item_id).first();assert.equal(item.unit_price,100);
 received=await send('/api/receive',{item_id:item.item_id,quantity:2,unit_mode:'main',sticker_mode:'main',lot:'CONVERT',expiry_date:'2028-12-31'});assert.equal(received.status,200);assert.equal(received.data.labels.length,2);assert.equal(received.data.labels[0].sub_count,5);
 assert.equal((await send('/api/items',{...base,has_sub_unit:1,sub_unit:'ขวด',sub_per_main:1.5})).status,400);
 const backup=await tenantRequest('tenant-a','/api/backup',{cookie});assert.equal(backup.data.tables.items.find(i=>i.item_id===id).has_sub_unit,0);
});

let workflowItem,receiptOperation,receiptBarcode,workflowPrLine,workflowCookie;
async function wfAuth(){if(!workflowCookie)workflowCookie=(await tenantRequest('tenant-a','/api/login',{method:'POST',body:{username:'admin',password}})).cookie;return workflowCookie;}
async function wfPost(path,body={},cookie){return tenantRequest('tenant-a',path,{method:'POST',cookie:cookie||await wfAuth(),body:{request_id:randomUUID(),...body}});}
test('stock operations commit once across parallel retries and reject reused payloads',async()=>{
 const cookie=await wfAuth();
 workflowItem=(await tenantRequest('tenant-a','/api/items',{method:'POST',cookie,body:{supplier_id:'test-supplier',reagent_name:'Workflow reagent',main_unit:'กล่อง',has_sub_unit:1,sub_unit:'ขวด',sub_per_main:5,main_unit_price:500}})).data.item_id;
 const body={request_id:randomUUID(),item_id:workflowItem,quantity:2,unit_mode:'main',sticker_mode:'main',lot:'WF',expiry_date:'2029-12-31'};
 const [a,b]=await Promise.all([wfPost('/api/receive',body,cookie),wfPost('/api/receive',body,cookie)]);
 assert.equal(a.status,200,JSON.stringify(a.data));assert.equal(b.status,200,JSON.stringify(b.data));assert.equal(a.data.operation_id,b.data.operation_id);
 assert.equal((await aDb.prepare("SELECT COUNT(*) AS n FROM stock_units WHERE item_id=?").bind(workflowItem).first()).n,10);
 const reused=await wfPost('/api/receive',{...body,quantity:3},cookie);assert.equal(reused.status,409);
 const status=await tenantRequest('tenant-a','/api/operations/status?request_id='+body.request_id,{cookie});assert.equal(status.data.result.total_sub,10);
 const old=await wfPost('/api/receive',body,cookie);assert.equal(old.data.labels[0].code,a.data.labels[0].code);
});
test('concurrent stock consumes never create duplicate movements; reversals preserve downstream work',async()=>{
 const pack=(await aDb.prepare('SELECT package_barcode FROM package_barcodes WHERE item_id=? LIMIT 1').bind(workflowItem).first()).package_barcode;
 const cookie=await wfAuth(),body={request_id:randomUUID(),barcode:pack,package_quantity:2};
 const [a,b]=await Promise.all([wfPost('/api/consume',body,cookie),wfPost('/api/consume',body,cookie)]);
 assert.equal(a.status,200,JSON.stringify(a.data));assert.equal(b.status,200);assert.equal(a.data.operation_id,b.data.operation_id);
 assert.equal(a.data.remaining_sub,3);
 assert.equal((await aDb.prepare('SELECT COUNT(*) AS n FROM movements WHERE movement_id=?').bind(a.data.operation_id).first()).n,1);
 const reversal=await wfPost('/api/operations/'+a.data.operation_id+'/reverse',{reason:'ตัดผิดรายการ'});assert.equal(reversal.status,200,JSON.stringify(reversal.data));
 assert.equal((await aDb.prepare("SELECT COUNT(*) AS n FROM stock_units WHERE parent_barcode=? AND status='IN_STOCK'").bind(pack).first()).n,5);
 assert.equal((await wfPost('/api/operations/'+a.data.operation_id+'/reverse',{reason:'ทำซ้ำ'})).status,409);
 const receive=(await aDb.prepare("SELECT operation_id FROM stock_operations WHERE item_id=? AND kind='RECEIVE' LIMIT 1").bind(workflowItem).first()).operation_id;
 assert.equal((await wfPost('/api/operations/'+receive+'/reverse',{reason:'ย้อนเกินรายการถัดไป'})).status,409);
});
test('write-offs require a reason and stay separate from consumption reports',async()=>{
 const code=(await aDb.prepare("SELECT barcode FROM stock_units WHERE item_id=? AND status='IN_STOCK' LIMIT 1").bind(workflowItem).first()).barcode;
 assert.equal((await wfPost('/api/consume',{barcode:code,kind:'DISPOSE'})).status,400);
 const disposed=await wfPost('/api/consume',{barcode:code,kind:'DISPOSE',reason:'ชำรุดจากการขนส่ง'});assert.equal(disposed.status,200);
 assert.equal((await aDb.prepare('SELECT status FROM stock_units WHERE barcode=?').bind(code).first()).status,'DISPOSED');
 const today=new Date().toISOString().slice(0,10),cookie=await wfAuth();
 const report=await tenantRequest('tenant-a',`/api/reports?type=dispose&from=${today}&to=${today}`,{cookie});assert.equal(report.status,200,JSON.stringify(report.data));assert.ok(report.data.rows.some(r=>r.movement_id===disposed.data.operation_id&&r.display_unit==='ขวด'));
 const used=await tenantRequest('tenant-a',`/api/reports?type=consume&from=${today}&to=${today}`,{cookie});assert.ok(!used.data.rows.some(r=>r.movement_id===disposed.data.operation_id));
 assert.equal((await wfPost('/api/operations/'+disposed.data.operation_id+'/reverse',{reason:'พบว่าไม่ชำรุด'})).status,200);
});
test('count approval detects stale snapshots and adds/reduces exact units with printable QR',async()=>{
 const count=await wfPost('/api/stock-counts',{item_id:workflowItem,lot:'COUNT',expiry_date:'2029-12-31',counted_qty:3,reason:'ตรวจนับพบเพิ่มเติม'});assert.equal(count.status,200,JSON.stringify(count.data));
 const approve=await wfPost('/api/stock-counts/'+count.data.count_id+'/approve');assert.equal(approve.status,200,JSON.stringify(approve.data));assert.equal(approve.data.labels.length,3);
 assert.equal((await wfPost('/api/stock-counts/'+count.data.count_id+'/approve')).status,409);
 const second=await wfPost('/api/stock-counts',{item_id:workflowItem,lot:'COUNT',expiry_date:'2029-12-31',counted_qty:1,reason:'ยอดนับจริงลดลง'});
 const reduced=await wfPost('/api/stock-counts/'+second.data.count_id+'/approve');assert.equal(reduced.status,200);assert.equal(reduced.data.difference,-2);
 const stale=await wfPost('/api/stock-counts',{item_id:workflowItem,lot:'COUNT',expiry_date:'2029-12-31',counted_qty:1,reason:'รอตรวจยืนยัน'});
 const code=(await aDb.prepare("SELECT barcode FROM stock_units WHERE item_id=? AND lot='COUNT' AND status='IN_STOCK'").bind(workflowItem).first()).barcode;
 assert.equal((await wfPost('/api/consume',{barcode:code,confirm_fefo:true})).status,200);
 assert.equal((await wfPost('/api/stock-counts/'+stale.data.count_id+'/approve')).status,409);
 assert.equal((await aDb.prepare('SELECT status FROM stock_counts WHERE count_id=?').bind(stale.data.count_id).first()).status,'PENDING');
});
test('PR partial receipts track outstanding quantities, reject overdelivery and reverse receipts',async()=>{
 const cookie=await wfAuth();
 const pr=await tenantRequest('tenant-a','/api/purchase-requisitions',{method:'POST',cookie,body:{requester:'Test',items:[{item_id:workflowItem,item_name:'Workflow reagent',order_qty:2,unit:'กล่อง'}]}});assert.equal(pr.status,200);
 const prId=pr.data.pr_id;
 await tenantRequest('tenant-a',`/api/purchase-requisitions/${prId}/approve`,{method:'PUT',cookie,body:{}});
 workflowPrLine=(await aDb.prepare('SELECT line_id FROM purchase_requisition_items WHERE pr_id=?').bind(prId).first()).line_id;
 const body={item_id:workflowItem,pr_line_id:workflowPrLine,quantity:1,unit_mode:'main',sticker_mode:'sub',lot:'PR',expiry_date:'2030-01-01'};
 const first=await wfPost('/api/receive',body);assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.total_sub,5);receiptOperation=first.data.operation_id;receiptBarcode=first.data.labels[0].code;
 assert.equal((await aDb.prepare('SELECT received_qty FROM purchase_requisition_items WHERE line_id=?').bind(workflowPrLine).first()).received_qty,1);
 assert.equal((await wfPost('/api/receive',{...body,quantity:2})).status,409);
 assert.equal((await tenantRequest('tenant-a',`/api/purchase-requisitions/${prId}/unapprove`,{method:'PUT',cookie,body:{}})).status,409);
 assert.equal((await tenantRequest('tenant-a',`/api/purchase-requisitions/${prId}`,{method:'PUT',cookie,body:{items:[]}})).status,409);
 assert.equal((await wfPost('/api/operations/'+first.data.operation_id+'/reverse',{reason:'รับผิดเอกสาร'})).status,200);
 assert.equal((await aDb.prepare('SELECT received_qty FROM purchase_requisition_items WHERE line_id=?').bind(workflowPrLine).first()).received_qty,0);
 const all=await wfPost('/api/receive',{...body,quantity:2});assert.equal(all.status,200);
 const outstanding=await tenantRequest('tenant-a','/api/pr-receiving',{cookie});assert.ok(!outstanding.data.rows.some(l=>l.line_id===workflowPrLine));
});
test('staff can submit counts but cannot approve or reverse; full backup restores workflow history',async()=>{
 const time=new Date().toISOString();const staffSalt='workflow-staff-salt';
 const {passwordHash}=await import('../subscription/src/security.js');
 await aDb.prepare("INSERT INTO users(user_id,username,password_hash,salt,role,is_active,created_at,updated_at) VALUES ('wf-staff','wf-staff',?,?,'staff',1,?,?)").bind(await passwordHash(password,staffSalt),staffSalt,time,time).run();
 const staff=(await tenantRequest('tenant-a','/api/login',{method:'POST',body:{username:'wf-staff',password}})).cookie;
 const submitted=await wfPost('/api/stock-counts',{item_id:workflowItem,lot:'STAFF',expiry_date:'2029-01-01',counted_qty:1,reason:'นับโดยเจ้าหน้าที่'},staff);assert.equal(submitted.status,200);
 assert.equal((await wfPost('/api/stock-counts/'+submitted.data.count_id+'/approve',{},staff)).status,403);
 assert.equal((await wfPost('/api/operations/'+receiptOperation+'/reverse',{reason:'เจ้าหน้าที่ลองย้อน'},staff)).status,403);
 const cookie=await wfAuth(),backup=await tenantRequest('tenant-a','/api/backup',{cookie});assert.ok(backup.data.tables.stock_operations.length>0);
 const restore=await tenantRequest('tenant-a','/api/restore',{method:'POST',cookie,body:backup.data});assert.equal(restore.status,200,JSON.stringify(restore.data));
 assert.equal((await aDb.prepare('SELECT reversed_by FROM stock_operations WHERE operation_id=?').bind(receiptOperation).first()).reversed_by.length>0,true);
 const otherCookie=(await tenantRequest('tenant-b','/api/login',{method:'POST',body:{username:'admin',password}})).cookie;
 const other=await tenantRequest('tenant-b','/api/operations',{cookie:otherCookie});assert.ok(!other.data.rows.some(o=>o.item_id===workflowItem));
});

test('different request IDs competing for one QR cannot both decrement stock',async()=>{
 const item=(await tenantRequest('tenant-a','/api/items',{method:'POST',cookie:await wfAuth(),body:{supplier_id:'test-supplier',reagent_name:'Race item',main_unit:'ขวด',has_sub_unit:0}})).data.item_id;
 const receipt=await wfPost('/api/receive',{item_id:item,quantity:1,lot:'RACE',expiry_date:'2030-01-01'});assert.equal(receipt.status,200);
 const barcode=receipt.data.labels[0].code;
 const results=await Promise.all([wfPost('/api/consume',{barcode}),wfPost('/api/consume',{barcode})]);
 assert.equal(results.filter(r=>r.status===200).length,1,JSON.stringify(results));
 assert.equal((await aDb.prepare("SELECT COUNT(*) AS n FROM movements WHERE item_id=? AND type='CONSUME'").bind(item).first()).n,1);
 assert.equal((await aDb.prepare("SELECT COUNT(*) AS n FROM stock_units WHERE item_id=? AND status='IN_STOCK'").bind(item).first()).n,0);
});
test('concurrent count approval commits once, unchanged counts are reversible and invalid dates fail safely',async()=>{
 const counted=await wfPost('/api/stock-counts',{item_id:workflowItem,lot:'RACE-COUNT',expiry_date:'2030-01-01',counted_qty:2,reason:'ตรวจนับพร้อมกัน'});
 const results=await Promise.all([wfPost('/api/stock-counts/'+counted.data.count_id+'/approve'),wfPost('/api/stock-counts/'+counted.data.count_id+'/approve')]);
 assert.equal(results.filter(r=>r.status===200).length,1,JSON.stringify(results));
 assert.equal((await aDb.prepare("SELECT COUNT(*) AS n FROM stock_units WHERE item_id=? AND lot='RACE-COUNT' AND status='IN_STOCK'").bind(workflowItem).first()).n,2);
 const same=await wfPost('/api/stock-counts',{item_id:workflowItem,lot:'RACE-COUNT',expiry_date:'2030-01-01',counted_qty:2,reason:'นับตรงกับระบบ'});
 const confirmed=await wfPost('/api/stock-counts/'+same.data.count_id+'/approve');assert.equal(confirmed.status,200);assert.equal(confirmed.data.difference,0);
 assert.equal((await wfPost('/api/operations/'+confirmed.data.operation_id+'/reverse',{reason:'ยืนยันผิดใบตรวจนับ'})).status,200);
 assert.equal((await wfPost('/api/receive',{item_id:workflowItem,quantity:1,lot:'INVALID',expiry_date:'2030-13-01'})).status,400);
});

test('dashboard aggregates analytics, enforces delivery date permissions and preserves terms in backup',async()=>{
 const cookie=await wfAuth(),today=new Date().toISOString().slice(0,10);
 const pr=(await aDb.prepare('SELECT pr_id FROM purchase_requisitions WHERE status=? LIMIT 1').bind('APPROVED').first()).pr_id;
 const save=await tenantRequest('tenant-a','/api/dashboard/delivery',{method:'PUT',cookie,body:{pr_id:pr,issued_date:today,expected_date:today}});assert.equal(save.status,200,JSON.stringify(save.data));
 const dashboard=await tenantRequest('tenant-a','/api/dashboard?period=day',{cookie});assert.equal(dashboard.status,200,JSON.stringify(dashboard.data));assert.equal(dashboard.data.analytics.range.days,1);assert.ok(Array.isArray(dashboard.data.analytics.inventory));assert.ok(dashboard.data.analytics.deliveries.some(r=>r.pr_id===pr&&r.eligible));
 const staff=(await tenantRequest('tenant-a','/api/login',{method:'POST',body:{username:'wf-staff',password}})).cookie;
 const publicData=await tenantRequest('tenant-a','/api/dashboard?period=day',{cookie:staff});assert.equal(publicData.data.analytics.inventory,null);
 assert.equal((await tenantRequest('tenant-a','/api/dashboard/delivery',{method:'PUT',cookie:staff,body:{pr_id:pr,issued_date:today,expected_date:today}})).status,403);
 assert.equal((await tenantRequest('tenant-a','/api/dashboard?period=custom&start=2026-02-30&end=2026-03-01',{cookie})).status,400);
 const budget=await tenantRequest('tenant-a','/api/dashboard/purchase-total',{method:'PUT',cookie,body:{start:today,end:today,total_value:5000}});assert.equal(budget.status,200);
 assert.equal((await tenantRequest('tenant-a','/api/dashboard?period=day',{cookie})).data.analytics.purchase_total,5000);
 assert.equal((await tenantRequest('tenant-a','/api/dashboard?period=day',{cookie:staff})).data.analytics.purchase_total,null);
 assert.equal((await tenantRequest('tenant-a','/api/dashboard/purchase-total',{method:'PUT',cookie:staff,body:{start:today,end:today,total_value:5000}})).status,403);
 const backup=await tenantRequest('tenant-a','/api/backup',{cookie});assert.ok(backup.data.tables.pr_delivery_terms.some(r=>r.pr_id===pr));assert.equal(backup.data.tables.analytics_purchase_totals[0].total_value,5000);
 assert.equal((await tenantRequest('tenant-a','/api/restore',{method:'POST',cookie,body:backup.data})).status,200);
 assert.equal((await aDb.prepare('SELECT issued_date FROM pr_delivery_terms WHERE pr_id=?').bind(pr).first()).issued_date,today);
});

test('supplier registry requires item links, protects master edits, and preserves receipt provenance',async()=>{
 const cookie=await wfAuth(),call=(path,body,method='POST')=>tenantRequest('tenant-a',path,{method,cookie,body});
 const created=await call('/api/suppliers',{name:' Supplier Alpha ',phone:'053000000'});assert.equal(created.status,200,JSON.stringify(created.data));const alpha=created.data.supplier_id;
 assert.equal((await call('/api/suppliers',{name:'supplier alpha'})).status,409);
 const beta=(await call('/api/suppliers',{name:'Supplier Beta'})).data.supplier_id;
 const itemBody={reagent_name:'Supplier tracking',main_unit:'ขวด',has_sub_unit:0,main_unit_price:20};
 assert.equal((await call('/api/items',itemBody)).status,400);
 assert.equal((await call('/api/items',{...itemBody,supplier_id:'missing'})).status,400);
 assert.equal((await call('/api/items',{...itemBody,supplier_id:'SUP-UNASSIGNED'})).status,400);
 const item=(await call('/api/items',{...itemBody,supplier_id:alpha})).data.item_id;assert.ok(item);
 const receive=await wfPost('/api/receive',{item_id:item,quantity:2,lot:'ALPHA',expiry_date:'2028-12-31'},cookie);assert.equal(receive.status,200,JSON.stringify(receive.data));
 const original=await aDb.prepare('SELECT supplier_id,supplier_verified FROM stock_units WHERE item_id=? LIMIT 1').bind(item).first();assert.equal(original.supplier_id,alpha);assert.equal(original.supplier_verified,1);
 assert.equal((await call('/api/items/'+item,{...itemBody,supplier_id:beta},'PUT')).status,200);
 const old=await tenantRequest('tenant-a','/api/suppliers/'+alpha,{cookie});assert.ok(old.data.stock.some(r=>r.item_id===item&&r.quantity===2));assert.ok(!old.data.items.some(r=>r.item_id===item));
 await wfPost('/api/receive',{item_id:item,quantity:1,lot:'BETA',expiry_date:'2028-12-31'},cookie);
 const latest=await tenantRequest('tenant-a','/api/suppliers/'+beta,{cookie});assert.ok(latest.data.items.some(r=>r.item_id===item));assert.ok(latest.data.stock.some(r=>r.item_id===item&&r.quantity===1));
 for(const row of (await aDb.prepare("SELECT barcode FROM stock_units WHERE item_id=? AND lot='ALPHA' AND status='IN_STOCK'").bind(item).all()).results)assert.equal((await wfPost('/api/consume',{barcode:row.barcode,confirm_fefo:true},cookie)).status,200);
 const history=await tenantRequest('tenant-a','/api/suppliers/'+alpha,{cookie});assert.ok(history.data.purchased.some(r=>r.item_id===item&&r.received_qty===2));assert.ok(!history.data.stock.some(r=>r.item_id===item));
 assert.equal((await call('/api/suppliers/'+beta,{name:'Supplier Beta Renamed',is_active:0},'PUT')).status,200);
 assert.equal((await aDb.prepare('SELECT supplier FROM items WHERE item_id=?').bind(item).first()).supplier,'Supplier Beta Renamed');
 assert.equal((await call('/api/items',{...itemBody,supplier_id:beta})).status,400);
 assert.equal((await call('/api/items/'+item,{...itemBody,supplier_id:beta},'PUT')).status,200);
 const staff=(await tenantRequest('tenant-a','/api/login',{method:'POST',body:{username:'wf-staff',password}})).cookie;
 assert.equal((await tenantRequest('tenant-a','/api/suppliers',{method:'POST',cookie:staff,body:{name:'No permission'}})).status,403);
 const listing=await tenantRequest('tenant-a','/api/suppliers',{cookie:staff});assert.ok(listing.data.rows.some(r=>r.supplier_id===alpha));
 const pr=await call('/api/purchase-requisitions',{requester:'Supplier test',items:[{item_id:item,item_name:itemBody.reagent_name,supplier:'Supplier Alpha',order_qty:1,unit:'ขวด'}]});assert.equal(pr.status,200);
 await call('/api/purchase-requisitions/'+pr.data.pr_id+'/approve',{},'PUT');
 const line=await aDb.prepare('SELECT line_id,supplier_id FROM purchase_requisition_items WHERE pr_id=?').bind(pr.data.pr_id).first();assert.equal(line.supplier_id,alpha);
 await call('/api/suppliers/'+alpha,{name:'Supplier Alpha Renamed'},'PUT');
 const prReceipt=await wfPost('/api/receive',{item_id:item,quantity:1,lot:'ALPHA-PR',expiry_date:'2028-12-31',pr_line_id:line.line_id},cookie);assert.equal(prReceipt.status,200,JSON.stringify(prReceipt.data));
 assert.equal((await aDb.prepare("SELECT supplier_id FROM stock_units WHERE item_id=? AND lot='ALPHA-PR'").bind(item).first()).supplier_id,alpha);
 const otherCookie=(await tenantRequest('tenant-b','/api/login',{method:'POST',body:{username:'admin',password}})).cookie;
 assert.equal((await tenantRequest('tenant-b','/api/suppliers/'+alpha,{cookie:otherCookie})).status,404);
 const backup=await tenantRequest('tenant-a','/api/backup',{cookie});assert.ok(backup.data.tables.suppliers.some(r=>r.supplier_id===alpha));
 assert.equal((await call('/api/restore',backup.data)).status,200);
 assert.equal((await aDb.prepare('SELECT supplier_id FROM stock_units WHERE item_id=? AND lot=? LIMIT 1').bind(item,'ALPHA').first()).supplier_id,alpha); const legacy=structuredClone(backup.data);delete legacy.tables.suppliers;
 for(const row of legacy.tables.items)delete row.supplier_id;
 for(const row of legacy.tables.stock_units){delete row.supplier_id;delete row.supplier_verified;}
 for(const row of legacy.tables.purchase_requisition_items)delete row.supplier_id;
 const restored=await call('/api/restore',legacy);assert.equal(restored.status,200,JSON.stringify(restored.data));
 assert.equal((await aDb.prepare('PRAGMA foreign_key_check').all()).results.length,0);
});

test('supplier migration backfills populated legacy tables without inventing unknown suppliers',async()=>{
 const legacy=new Miniflare(convertV4MiniflareOptions({workers:[{name:'legacy',modules:[{type:'ESModule',path:'worker.js',contents:'export default {fetch(){return new Response("ok")}}'}],compatibilityDate:'2026-08-31',d1Databases:{DB:'legacy'}}]}));
 try{
 const database=await legacy.getD1Database('DB','legacy');
 for(const file of (await readdir('migrations')).sort().filter(f=>f<'0009'))await sql(database,await readFile('migrations/'+file,'utf8'));
 for(const [id,vendor]of [['one',' Vendor '],['two','vendor'],['unknown','']]){
 await database.prepare("INSERT INTO items(item_id,reagent_name,supplier,created_at,updated_at) VALUES(?,?,?,datetime('now'),datetime('now'))").bind(id,id,vendor).run();
 await database.prepare("INSERT INTO stock_units(barcode,item_id,reagent_name,expiry_date,received_at) VALUES(?,?,?,'2028-01-01',datetime('now'))").bind(id,id,id).run();
 }
 await sql(database,await readFile('migrations/0009_suppliers.sql','utf8'));
 const one=await database.prepare("SELECT supplier_id,supplier FROM items WHERE item_id='one'").first(),two=await database.prepare("SELECT supplier_id FROM items WHERE item_id='two'").first();assert.equal(one.supplier_id,two.supplier_id);
 assert.equal((await database.prepare("SELECT supplier_id FROM items WHERE item_id='unknown'").first()).supplier_id,'SUP-UNASSIGNED');
 const stock=await database.prepare("SELECT supplier_id,supplier_verified FROM stock_units WHERE barcode='one'").first();assert.equal(stock.supplier_id,one.supplier_id);assert.equal(stock.supplier_verified,0);
 assert.equal((await database.prepare('PRAGMA foreign_key_check').all()).results.length,0);
 }finally{await legacy.dispose();}
});

test('lot management preserves QR and package identity, guards history and stale counts',async()=>{
 const cookie=await wfAuth(),vendor=await aDb.prepare('SELECT supplier_id FROM suppliers WHERE is_placeholder=0 AND is_active=1 LIMIT 1').first();
 const item=(await tenantRequest('tenant-a','/api/items',{method:'POST',cookie,body:{supplier_id:vendor.supplier_id,reagent_name:'Lot management',main_unit:'กล่อง',has_sub_unit:1,sub_unit:'ขวด',sub_per_main:2}})).data.item_id;
 const receipt=await wfPost('/api/receive',{item_id:item,quantity:2,unit_mode:'main',sticker_mode:'main',lot:'ORIGINAL',expiry_date:'2028-01-01'},cookie);assert.equal(receipt.status,200);
 await wfPost('/api/receive',{item_id:item,quantity:1,lot:'EXISTING',expiry_date:'2028-01-01'},cookie);
 const count=await wfPost('/api/stock-counts',{item_id:item,lot:'ORIGINAL',expiry_date:'2028-01-01',counted_qty:4,reason:'Before lot edit'},cookie);
 const original=(await aDb.prepare("SELECT barcode,parent_barcode,supplier_id FROM stock_units WHERE item_id=? AND lot='ORIGINAL' ORDER BY barcode").bind(item).all()).results;
 const body={item_id:item,lot:'ORIGINAL',expiry_date:'2028-01-01',new_lot:'CORRECTED',new_expiry_date:'2028-02-01',expected_count:4,reason:'Correct received lot',request_id:randomUUID()};
 assert.equal((await wfPost('/api/item-lots/edit',{...body,new_lot:'EXISTING',new_expiry_date:'2028-01-01',request_id:randomUUID()},cookie)).status,409);
 assert.equal((await wfPost('/api/item-lots/edit',{...body,expected_count:3,request_id:randomUUID()},cookie)).status,409);
 const edited=await wfPost('/api/item-lots/edit',body,cookie);assert.equal(edited.status,200,JSON.stringify(edited.data));assert.equal(edited.data.updated_units,4);
 const replay=await wfPost('/api/item-lots/edit',body,cookie);assert.equal(replay.status,200);assert.equal(replay.data.operation_id,edited.data.operation_id);
 assert.deepEqual((await aDb.prepare("SELECT barcode,parent_barcode,supplier_id FROM stock_units WHERE item_id=? AND lot='CORRECTED' ORDER BY barcode").bind(item).all()).results,original);
 assert.equal((await aDb.prepare('SELECT lot,expiry_date FROM package_barcodes WHERE package_barcode=?').bind(original[0].parent_barcode).first()).lot,'CORRECTED');
 assert.equal((await wfPost('/api/stock-counts/'+count.data.count_id+'/approve',{},cookie)).status,409);
 assert.equal((await wfPost('/api/operations/'+receipt.data.operation_id+'/reverse',{reason:'Cannot reverse after edit'},cookie)).status,409);
 const list=await tenantRequest('tenant-a','/api/item-lots?item_id='+item,{cookie});assert.equal(list.status,200);assert.ok(list.data.rows.some(r=>r.lot==='CORRECTED'&&r.in_stock===4));
 const units=await tenantRequest('tenant-a','/api/item-lots/units?'+new URLSearchParams({item_id:item,lot:'CORRECTED',expiry_date:'2028-02-01'}),{cookie});assert.equal(units.data.rows.length,4);
 await wfPost('/api/consume',{barcode:original[0].barcode,confirm_fefo:true},cookie);
 assert.equal((await wfPost('/api/item-lots/edit',{...body,lot:'CORRECTED',expiry_date:'2028-02-01',new_lot:'FORBIDDEN',request_id:randomUUID()},cookie)).status,409);
 const staff=(await tenantRequest('tenant-a','/api/login',{method:'POST',body:{username:'wf-staff',password}})).cookie;
 assert.equal((await wfPost('/api/item-lots/edit',{...body,request_id:randomUUID()},staff)).status,403);
 const otherCookie=(await tenantRequest('tenant-b','/api/login',{method:'POST',body:{username:'admin',password}})).cookie;
 assert.equal((await tenantRequest('tenant-b','/api/item-lots?item_id='+item,{cookie:otherCookie})).status,404);
});

test('deleting supplier moves item, stock and PR links atomically to unassigned and preserves stock',async()=>{
 const cookie=await wfAuth(),call=(path,body,method='POST')=>tenantRequest('tenant-a',path,{method,cookie,body});
 const supplier=(await call('/api/suppliers',{name:'Supplier to delete'})).data.supplier_id;
 const item=(await call('/api/items',{supplier_id:supplier,reagent_name:'Deletion test',main_unit:'ขวด',has_sub_unit:0})).data.item_id;
 await wfPost('/api/receive',{item_id:item,quantity:2,lot:'DELETE-SUPPLIER',expiry_date:'2028-01-01'},cookie);
 const pr=await call('/api/purchase-requisitions',{requester:'Delete test',items:[{item_id:item,item_name:'Deletion test',supplier:'Supplier to delete',order_qty:1,unit:'ขวด'}]});
 const before=(await aDb.prepare('SELECT barcode,status,lot,expiry_date FROM stock_units WHERE item_id=? ORDER BY barcode').bind(item).all()).results;
 const staff=(await tenantRequest('tenant-a','/api/login',{method:'POST',body:{username:'wf-staff',password}})).cookie;
 assert.equal((await tenantRequest('tenant-a','/api/suppliers/'+supplier,{method:'DELETE',cookie:staff})).status,403);
 assert.equal((await call('/api/suppliers/SUP-UNASSIGNED',undefined,'DELETE')).status,400);
 assert.equal((await call('/api/suppliers/'+supplier,undefined,'DELETE')).status,200);
 assert.equal((await aDb.prepare('SELECT supplier_id FROM items WHERE item_id=?').bind(item).first()).supplier_id,'SUP-UNASSIGNED');
 assert.deepEqual((await aDb.prepare('SELECT barcode,status,lot,expiry_date FROM stock_units WHERE item_id=? ORDER BY barcode').bind(item).all()).results,before);
 assert.equal((await aDb.prepare("SELECT COUNT(*) n FROM stock_units WHERE item_id=? AND supplier_id='SUP-UNASSIGNED' AND supplier_verified=0").bind(item).first()).n,2);
 assert.equal((await aDb.prepare('SELECT supplier_id FROM purchase_requisition_items WHERE pr_id=?').bind(pr.data.pr_id).first()).supplier_id,'SUP-UNASSIGNED');
 assert.equal((await call('/api/suppliers/'+supplier,undefined,'DELETE')).status,200);
 assert.equal((await aDb.prepare("SELECT COUNT(*) n FROM audit_logs WHERE target_id=? AND action='DELETE_SUPPLIER'").bind(supplier).first()).n,1);
 assert.equal((await aDb.prepare('PRAGMA foreign_key_check').all()).results.length,0);
 assert.equal((await tenantRequest('tenant-a','/api/suppliers/'+supplier,{cookie})).status,404);
});

test('dashboard expired disposal affects only selected expired lot and supports replay, audit and reversal',async()=>{
 const cookie=await wfAuth(),vendor=await aDb.prepare('SELECT supplier_id FROM suppliers WHERE is_placeholder=0 AND is_active=1 LIMIT 1').first();
 const item=(await tenantRequest('tenant-a','/api/items',{method:'POST',cookie,body:{supplier_id:vendor.supplier_id,reagent_name:'Expired disposal test',main_unit:'กล่อง',sub_unit:'ขวด',has_sub_unit:1,sub_per_main:3,main_unit_price:300}})).data.item_id;
 await wfPost('/api/receive',{item_id:item,quantity:2,unit_mode:'main',sticker_mode:'main',lot:'EXPIRED',expiry_date:'2020-01-01'},cookie);
 await wfPost('/api/receive',{item_id:item,quantity:1,lot:'FUTURE',expiry_date:'2099-01-01'},cookie);
 const body={request_id:randomUUID(),item_id:item,lot:'EXPIRED',expiry_date:'2020-01-01',quantity:2,expected_count:6,reason:'น้ำยาหมดอายุ ตรวจสอบแล้ว'};
 assert.equal((await wfPost('/api/dispose-expired',{...body,request_id:randomUUID(),expiry_date:'2099-01-01',lot:'FUTURE',expected_count:1,quantity:1},cookie)).status,400);
 assert.equal((await wfPost('/api/dispose-expired',{...body,request_id:randomUUID(),expected_count:5},cookie)).status,409);
 const result=await wfPost('/api/dispose-expired',body,cookie);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.remaining_sub,4);
 const replay=await wfPost('/api/dispose-expired',body,cookie);assert.equal(replay.data.operation_id,result.data.operation_id);assert.equal(replay.data.replayed,true);
 assert.equal((await aDb.prepare("SELECT COUNT(*) n FROM stock_units WHERE item_id=? AND lot='EXPIRED' AND status='DISPOSED'").bind(item).first()).n,2);
 assert.equal((await aDb.prepare("SELECT COUNT(*) n FROM stock_units WHERE item_id=? AND lot='FUTURE' AND status='IN_STOCK'").bind(item).first()).n,1);
 const movement=await aDb.prepare('SELECT type,quantity_sub,operator_note FROM movements WHERE movement_id=?').bind(result.data.operation_id).first();assert.equal(movement.type,'DISPOSE');assert.equal(movement.quantity_sub,2);assert.match(movement.operator_note,/หมดอายุ/);
 assert.equal((await aDb.prepare('SELECT COUNT(*) n FROM stock_operation_units WHERE operation_id=?').bind(result.data.operation_id).first()).n,2);
 assert.equal((await wfPost('/api/operations/'+result.data.operation_id+'/reverse',{reason:'Reverse test disposal'},cookie)).status,200);
 assert.equal((await aDb.prepare("SELECT COUNT(*) n FROM stock_units WHERE item_id=? AND lot='EXPIRED' AND status='IN_STOCK'").bind(item).first()).n,6);
 const staff=(await tenantRequest('tenant-a','/api/login',{method:'POST',body:{username:'wf-staff',password}})).cookie;
 assert.equal((await wfPost('/api/dispose-expired',{...body,request_id:randomUUID(),quantity:6},staff)).status,200);
 assert.equal((await aDb.prepare("SELECT COUNT(*) n FROM package_barcodes WHERE item_id=? AND status='IN_STOCK'").bind(item).first()).n,0);
 assert.equal((await wfPost('/api/dispose-expired',{...body,request_id:randomUUID()},cookie)).status,409);
});

test('split PR creates atomic supplier documents, validates all lines, and safely replays',async()=>{
 const cookie=await wfAuth(),call=(path,body)=>tenantRequest('tenant-a',path,{method:'POST',cookie,body});
 const s1=(await call('/api/suppliers',{name:'Split supplier A'})).data.supplier_id;
 const s2=(await call('/api/suppliers',{name:'Split supplier B'})).data.supplier_id;
 const i1=(await call('/api/items',{reagent_name:'Split reagent A',main_unit:'ขวด',has_sub_unit:0,main_unit_price:30,supplier_id:s1})).data.item_id;
 const i2=(await call('/api/items',{reagent_name:'Split reagent B',main_unit:'ขวด',has_sub_unit:0,main_unit_price:40,supplier_id:s2})).data.item_id;
 const body={request_id:randomUUID(),pr_no:'SPLIT-TEST',requester:'Requester',department:'Lab',request_date:'2026-10-23',items:[{item_id:i1,name:'Split reagent A',supplier:'Split supplier A',order_qty:2,unit:'ขวด',unit_price:30},{item_id:i2,name:'Split reagent B',supplier:'Split supplier B',order_qty:3,unit:'ขวด',unit_price:40}]};
 const result=await call('/api/purchase-requisitions/split',body);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.rows.length,2);assert.deepEqual(result.data.rows.map(r=>r.pr_no),['SPLIT-TEST-01','SPLIT-TEST-02']);
 for(const r of result.data.rows){const pr=await aDb.prepare('SELECT * FROM purchase_requisitions WHERE pr_id=?').bind(r.pr_id).first();assert.equal(pr.status,'PENDING');assert.equal(pr.requester,'Requester');assert.equal(pr.department,'Lab');const lines=(await aDb.prepare('SELECT supplier FROM purchase_requisition_items WHERE pr_id=?').bind(r.pr_id).all()).results;assert.deepEqual(lines.map(l=>l.supplier),[r.supplier]);}
 assert.deepEqual((await call('/api/purchase-requisitions/split',body)).data,result.data);
 assert.equal((await call('/api/purchase-requisitions/split',{...body,department:'Changed'})).status,409);
 assert.equal((await call('/api/purchase-requisitions/split',{...body,request_id:randomUUID(),pr_no:'SPLIT-BAD',items:[body.items[0],{...body.items[1],supplier:'Unknown'}]})).status,400);
 assert.equal((await aDb.prepare("SELECT COUNT(*) n FROM purchase_requisitions WHERE pr_no LIKE 'SPLIT-BAD%'").first()).n,0);
 const failed=await call('/api/purchase-requisitions/split',{...body,request_id:randomUUID()});assert.notEqual(failed.status,200);assert.equal((await aDb.prepare("SELECT COUNT(*) n FROM purchase_requisitions WHERE pr_no LIKE 'SPLIT-TEST%'").first()).n,2);
 assert.equal((await aDb.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='CREATE_PR' AND target_id LIKE 'SPLIT-TEST%'").first()).n,2);
});

test('PR suggestions ignore dashboard search and analytics filters and protect staff prices',async()=>{
 const cookie=await wfAuth();
 const filtered=await tenantRequest('tenant-a','/api/dashboard?q=NO-MATCH-SEARCH-47',{cookie});assert.equal(filtered.status,200);assert.equal(filtered.data.rows.length,0);
 const suggestions=await tenantRequest('tenant-a','/api/pr-suggestions?q=NO-MATCH-SEARCH-47&machine=NO-MATCH&period=invalid',{cookie});assert.equal(suggestions.status,200,JSON.stringify(suggestions.data));assert.ok(suggestions.data.rows.length>0);assert.equal(suggestions.data.analytics,null);
 const staff=(await tenantRequest('tenant-a','/api/login',{method:'POST',body:{username:'wf-staff',password}})).cookie;
 const publicRows=await tenantRequest('tenant-a','/api/pr-suggestions',{cookie:staff});assert.equal(publicRows.status,200);assert.ok(publicRows.data.rows.length>0);assert.equal(publicRows.data.analytics,null);assert.equal(publicRows.data.total_value,null);assert.equal(publicRows.data.rows[0].unit_price,undefined);
});

test('item live stock counts only IN_STOCK units and is available to staff without prices',async()=>{
 const cookie=await wfAuth();
 const result=await tenantRequest('tenant-a','/api/items?include_stock=1',{cookie});assert.equal(result.status,200);
 assert.ok(result.data.rows.length);
 for(const row of result.data.rows){const expected=await aDb.prepare("SELECT COUNT(*) n FROM stock_units WHERE item_id=? AND status='IN_STOCK'").bind(row.item_id).first();assert.equal(row.stock_quantity,expected.n);}
 const staff=(await tenantRequest('tenant-a','/api/login',{method:'POST',body:{username:'wf-staff',password}})).cookie;
 const visible=await tenantRequest('tenant-a','/api/items?include_stock=1',{cookie:staff});assert.equal(visible.status,200);assert.equal(typeof visible.data.rows[0].stock_quantity,'number');assert.equal(visible.data.rows[0].main_unit_price,undefined);
 const master=await tenantRequest('tenant-a','/api/items',{cookie});assert.equal(master.data.rows[0].stock_quantity,undefined);
});
