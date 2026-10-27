import {test,after,before} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SignJWT,exportJWK,generateKeyPair} from 'jose';
const require=createRequire(import.meta.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=require('miniflare'),esbuild=require('esbuild');

// Both Medical Trend Workers trust only a Cloudflare Access JWT signed by the team's keys for their own AUD.
const TEAM='https://medicaltrend.cloudflareaccess.com',STOCK_AUD='stock-aud-test',CONTROL_AUD='control-aud-test';
const OWNER='chanat@medicaltrend.co.th';
let mf,stockDb,controlDb,key,otherKey,jwks;
async function jwt(email,{aud=STOCK_AUD,iss=TEAM,exp='5m',signer=key}={}){
 const claims=email===undefined?{}:{email};
 return new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:signer===key?'team-key':'rogue-key'}).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(signer.privateKey);
}
async function call(host,path,{token,method='GET',body,headers={}}={}){
 const url='https://'+host+path;
 const response=await mf.dispatchFetch(url,{method,headers:{...(token?{'cf-access-jwt-assertion':token}:{}),origin:'https://'+host,'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
 return {status:response.status,data,headers:response.headers};
}
const stock=(path,options)=>call('stock.example',path,options);
const control=(path,options)=>call('control.example',path,options);
async function sql(db,source){for(const statement of source.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();}

before(async()=>{
 await mkdir(resolve('work'),{recursive:true});
 key=await generateKeyPair('RS256');otherKey=await generateKeyPair('RS256');
 jwks={keys:[{...await exportJWK(key.publicKey),kid:'team-key',alg:'RS256',use:'sig'}]};
 const certs=async request=>new URL(request.url).href===TEAM+'/cdn-cgi/access/certs'?Response.json(jwks):new Response('unexpected outbound fetch',{status:599});
 const bundle=async file=>(await esbuild.build({entryPoints:[file],bundle:true,write:false,format:'esm',platform:'browser',mainFields:['browser','module','main'],conditions:['workerd','browser'],logLevel:'silent'})).outputFiles[0].text;
 const [controlCode,stockCode]=await Promise.all([bundle('subscription/src/index.js'),bundle('src/index.js')]);
 const worker=(name,code,extra)=>({name,routes:[name+'.example/*','localhost/*'].slice(0,name==='stock'?2:1),modules:[{type:'ESModule',path:'worker.js',contents:code}],compatibilityDate:'2026-08-31',compatibilityFlags:['nodejs_compat'],outboundService:certs,serviceBindings:{ASSETS:()=>new Response('static asset')},...extra});
 mf=new Miniflare(convertV4MiniflareOptions({defaultPersistRoot:resolve('work/test-access-'+randomUUID()),workers:[
  worker('stock',stockCode,{d1Databases:{DB:'stock-db'},bindings:{ACCESS_TEAM_DOMAIN:TEAM,ACCESS_AUD:STOCK_AUD,DEV_ACCESS_EMAIL:'dev@medicaltrend.co.th'}}),
  worker('control',controlCode,{d1Databases:{CONTROL_DB:'control-db'},bindings:{ACCESS_TEAM_DOMAIN:TEAM,ACCESS_AUD:CONTROL_AUD,ADMIN_EMAIL:OWNER}}),
 ]}));
 stockDb=await mf.getD1Database('DB','stock');controlDb=await mf.getD1Database('CONTROL_DB','control');
 for(const file of (await readdir('migrations')).sort())await sql(stockDb,await readFile('migrations/'+file,'utf8'));
 for(const file of (await readdir('subscription/migrations')).sort())await sql(controlDb,await readFile('subscription/migrations/'+file,'utf8'));
 const stamp=new Date().toISOString();
 for(const [id,username,email,role]of [['USR-A','somchai','somchai@medicaltrend.co.th','admin'],['USR-S','malee','Malee@MedicalTrend.co.th','staff'],['USR-X','retired','retired@medicaltrend.co.th','staff'],['USR-D','dev','dev@medicaltrend.co.th','staff']])
  await stockDb.prepare("INSERT INTO users(user_id,username,email,password_hash,salt,role,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id,username,email,'legacy-hash','legacy-salt',role,id==='USR-X'?0:1,stamp,stamp).run();
});
after(async()=>{await mf?.dispose();});

test('stock: missing or invalid Access JWT is rejected with 401 on API and pages',async()=>{
 for(const path of ['/api/me','/api/items','/','/app.js'])assert.equal((await stock(path)).status,401,path);
 const bad={
  garbage:'not-a-jwt',
  wrongSignature:await jwt('somchai@medicaltrend.co.th',{signer:otherKey}),
  wrongAudience:await jwt('somchai@medicaltrend.co.th',{aud:CONTROL_AUD}),
  wrongIssuer:await jwt('somchai@medicaltrend.co.th',{iss:'https://evil.cloudflareaccess.com'}),
  expired:await jwt('somchai@medicaltrend.co.th',{exp:Math.floor(Date.now()/1000)-60}),
  noEmail:await jwt(undefined),
 };
 for(const [name,token]of Object.entries(bad)){const r=await stock('/api/me',{token});assert.equal(r.status,401,name);assert.equal(r.data.auth,'access');}
});
test('stock: unknown or deactivated email gets 403',async()=>{
 for(const email of ['stranger@medicaltrend.co.th','retired@medicaltrend.co.th']){
  const r=await stock('/api/me',{token:await jwt(email)});assert.equal(r.status,403,email);assert.match(r.data.error,/ยังไม่ได้ลงทะเบียน/);
 }
});
test('stock: valid JWT maps email (case-insensitive) to the user and keeps role permissions',async()=>{
 const admin=await stock('/api/me',{token:await jwt('somchai@medicaltrend.co.th')});
 assert.equal(admin.status,200);assert.equal(admin.data.user.username,'somchai');assert.equal(admin.data.user.role,'admin');assert.equal(admin.data.auth,'access');
 const staffToken=await jwt('MALEE@medicaltrend.co.th');
 const staff=await stock('/api/me',{token:staffToken});assert.equal(staff.status,200);assert.equal(staff.data.user.username,'malee');assert.equal(staff.data.user.role,'staff');
 assert.equal((await stock('/api/users',{token:staffToken})).status,403);
 const users=await stock('/api/users',{token:await jwt('somchai@medicaltrend.co.th')});assert.equal(users.status,200);
 assert.ok(users.data.rows.some(u=>u.email==='malee@medicaltrend.co.th'||u.email==='Malee@MedicalTrend.co.th'));
 const page=await stock('/',{token:staffToken});assert.equal(page.status,200);assert.equal(page.data,'static asset');
});
test('stock: password login, password change and the default admin are gone',async()=>{
 const token=await jwt('somchai@medicaltrend.co.th');
 assert.equal((await stock('/api/login',{method:'POST',token,body:{username:'admin',password:'1111'}})).status,404);
 assert.equal((await stock('/api/me/password',{method:'PUT',token,body:{current_password:'x',new_password:'y',confirm_password:'y'}})).status,404);
 assert.equal((await stockDb.prepare("SELECT COUNT(*) AS n FROM users WHERE lower(username)='admin'").first()).n,0);
 const me=await stock('/api/me',{token});assert.equal(me.headers.get('set-cookie'),null);
});
test('stock: admins manage users by email; duplicates and missing emails are refused',async()=>{
 const token=await jwt('somchai@medicaltrend.co.th');
 assert.equal((await stock('/api/users',{method:'POST',token,body:{username:'nid',role:'staff'}})).status,400);
 assert.equal((await stock('/api/users',{method:'POST',token,body:{username:'nid',email:'malee@medicaltrend.co.th',role:'staff'}})).status,400);
 assert.equal((await stock('/api/users',{method:'POST',token,body:{username:'nid',email:'Nid@MedicalTrend.co.th',role:'staff'}})).status,200);
 const nid=await stock('/api/me',{token:await jwt('nid@medicaltrend.co.th')});assert.equal(nid.status,200);assert.equal(nid.data.user.role,'staff');
 const row=await stockDb.prepare("SELECT * FROM users WHERE username='nid'").first();assert.equal(row.email,'nid@medicaltrend.co.th');assert.equal(row.password_hash,'ACCESS_ONLY');
 const audit=await stockDb.prepare("SELECT * FROM audit_logs WHERE action='ADD_USER' AND target_id='nid'").first();assert.equal(audit.username,'somchai');
});
test('stock: restore refuses a backup that would lock the restoring admin out',async()=>{
 const token=await jwt('somchai@medicaltrend.co.th');
 const r=await stock('/api/restore',{method:'POST',token,body:{tables:{users:[{user_id:'USR-A',username:'somchai',password_hash:'h',salt:'s',role:'admin',is_active:1,created_at:'x',updated_at:'x'}]}}});
 assert.equal(r.status,400);assert.equal((await stockDb.prepare('SELECT COUNT(*) AS n FROM users').first()).n>=4,true);
});
test('stock: DEV_ACCESS_EMAIL bypass works only on localhost',async()=>{
 const local=await call('localhost','/api/me');assert.equal(local.status,200);assert.equal(local.data.user.username,'dev');
 const asAdmin=await call('localhost','/api/me',{headers:{'x-dev-user-email':'somchai@medicaltrend.co.th'}});assert.equal(asAdmin.data.user.role,'admin');
 assert.equal((await stock('/api/me',{headers:{'x-dev-user-email':'somchai@medicaltrend.co.th'}})).status,401);
});

test('subscription: missing or invalid Access JWT is rejected with 401',async()=>{
 for(const path of ['/api/me','/api/tenants','/'])assert.equal((await control(path)).status,401,path);
 for(const token of ['garbage',await jwt(OWNER,{aud:STOCK_AUD}),await jwt(OWNER,{aud:CONTROL_AUD,signer:otherKey}),await jwt(OWNER,{aud:CONTROL_AUD,exp:Math.floor(Date.now()/1000)-60})])
  assert.equal((await control('/api/me',{token})).status,401);
});
test('subscription: unknown email gets 403 and creates nothing',async()=>{
 const r=await control('/api/me',{token:await jwt('somchai@medicaltrend.co.th',{aud:CONTROL_AUD})});
 assert.equal(r.status,403);assert.equal(await controlDb.prepare('SELECT id FROM admins').first(),null);
});
test('subscription: ADMIN_EMAIL becomes the owner via Access and keeps owner permissions',async()=>{
 const token=await jwt('Chanat@MedicalTrend.co.th',{aud:CONTROL_AUD});
 const me=await control('/api/me',{token});assert.equal(me.status,200);assert.deepEqual(me.data.user,{id:'owner',email:OWNER});assert.equal(me.data.logout_url,'/cdn-cgi/access/logout');
 const owner=await controlDb.prepare('SELECT * FROM admins').first();assert.equal(owner.password_hash,'ACCESS_ONLY');
 assert.equal((await controlDb.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='OWNER_CREATED'").first()).n,1);
 assert.equal((await control('/api/me',{token})).status,200);
 assert.equal((await controlDb.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='OWNER_CREATED'").first()).n,1);
 assert.equal((await control('/api/tenants',{token})).status,200);
 assert.equal((await control('/api/tenants',{method:'POST',token,body:{},headers:{origin:'https://evil.example'}})).status,403);
 for(const path of ['/api/login','/api/setup','/api/logout'])assert.equal((await control(path,{method:'POST',token,body:{}})).status,404,path);
 assert.equal((await control('/api/password',{method:'PUT',token,body:{}})).status,404);
});
test('subscription: Service Binding endpoint stays token-protected without Access',async()=>{
 const r=await control('/internal/subscription',{method:'POST',body:{tenant_id:'missing'}});assert.equal(r.status,404);
});
