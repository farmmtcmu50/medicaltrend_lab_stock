import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir,chmod} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {randomBytes,createHash,randomUUID} from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url));
const cli=join(root,'node_modules/wrangler/bin/wrangler.js');
const privateDir=join(root,'.provisioning');
const configPath=join(root,'subscription/wrangler.jsonc');
const config=JSON.parse(await readFile(configPath,'utf8'));
const args=process.argv.slice(2),command=args.shift(),local=args.includes('--local');
const token=()=>randomBytes(32).toString('hex');
const hash=s=>createHash('sha256').update(s).digest('hex');
const quote=s=>s===null?'NULL':"'"+String(s).replaceAll("'","''")+"'";
await mkdir(privateDir,{recursive:true,mode:0o700});await chmod(privateDir,0o700);
async function privateWrite(path,value){await writeFile(path,value,{mode:0o600});await chmod(path,0o600);}
function wrangler(arguments_,input){return new Promise((res,rej)=>{
 const child=spawn(process.execPath,[cli,...arguments_],{cwd:root,env:{...process.env,WRANGLER_LOG_PATH:join(root,'.wrangler/logs'),WRANGLER_SEND_METRICS:'false'},stdio:['pipe','pipe','pipe']});
 let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
 child.on('error',rej);child.on('close',code=>code===0?res(output):rej(new Error(output)));
 child.stdin.end(input||'');
});}
function parseJSON(output){try{return JSON.parse(output);}catch{const i=output.indexOf('['),j=output.lastIndexOf(']');if(i>=0&&j>=i)return JSON.parse(output.slice(i,j+1));throw new Error('อ่าน JSON จาก Wrangler ไม่ได้');}}
async function query(sql){
 // --file uses Cloudflare's bulk-import API remotely and returns import metrics,
 // not SELECT/RETURNING rows. Pass SQL as one argv value, never through a shell.
 const result=parseJSON(await wrangler(['d1','execute','medical-trend-subscriptions','--config',configPath,local?'--local':'--remote','--command',sql,'--json']));
 return result.flatMap(r=>r.results||[]);
}
async function audit(tid,action,details={}){await query(`INSERT INTO audit_events VALUES (${quote(randomUUID())},${quote(tid)},'cloudflare-operator',${quote(action)},${quote(JSON.stringify(details))},${quote(new Date().toISOString())});`);}
function tenantConfig(tenant){return {name:tenant.worker_name,main:join(root,'src/index.js'),compatibility_date:config.compatibility_date,compatibility_flags:['nodejs_compat'],workers_dev:true,preview_urls:false,
 assets:{directory:join(root,'public'),binding:'ASSETS',not_found_handling:'single-page-application',run_worker_first:true},
 d1_databases:[{binding:'DB',database_name:tenant.database_name,database_id:tenant.database_id,migrations_dir:join(root,'migrations')}],
 services:[{binding:'SUBSCRIPTIONS',service:config.name}],vars:{TENANT_ID:tenant.id,APP_NAME:tenant.name,SESSION_COOKIE:'mt_stock_'+tenant.slug.replaceAll('-','_')}};}
async function findDatabase(name){const dbs=parseJSON(await wrangler(['d1','list','--json','--config',configPath]));return dbs.find(d=>d.name===name);}
async function createDatabase(name){
 const result=await wrangler(['d1','create',name,'--location','apac','--config',configPath]);
 const match=result.match(/"database_id"\s*:\s*"([a-f0-9-]{36})"/)||result.match(/database_id\s*=\s*"([a-f0-9-]{36})"/);
 if(match)return match[1];const found=await findDatabase(name);if(!found)throw new Error('สร้างฐานข้อมูลแล้วแต่หา ID ไม่พบ โปรดตรวจ Cloudflare ก่อนรันซ้ำ');return found.uuid;
}
async function init(){
 if(!local){
  await wrangler(['whoami']);
  let existing=await findDatabase('medical-trend-subscriptions');
  if(config.d1_databases[0].database_id==='00000000-0000-0000-0000-000000000000'){
   if(existing)throw new Error('พบฐานข้อมูลส่วนกลางชื่อนี้แล้ว กรุณาตรวจและระบุ database_id ใน subscription/wrangler.jsonc ก่อน เพื่อป้องกันการใช้ฐานผิด');
   config.d1_databases[0].database_id=await createDatabase('medical-trend-subscriptions');
   await writeFile(configPath,JSON.stringify(config,null,2)+'\n');
  }else if(!existing||existing.uuid!==config.d1_databases[0].database_id)throw new Error('ชื่อและ ID ฐานข้อมูลส่วนกลางไม่ตรงกับบัญชี Cloudflare');
 }
 console.log('กำลังสร้าง/อัปเดตตารางส่วนกลาง ('+(local?'local':'remote')+')');
 await wrangler(['d1','migrations','apply','medical-trend-subscriptions','--config',configPath,local?'--local':'--remote']);
 const existing=await query("SELECT id FROM admins WHERE id='owner'");
 const setupPath=join(privateDir,local?'control-local-secrets.json':'control-secrets.json');
 let secrets;try{secrets=JSON.parse(await readFile(setupPath,'utf8'));}catch{secrets={SETUP_TOKEN:token()};await privateWrite(setupPath,JSON.stringify(secrets));}
 if(local){await privateWrite(join(root,'subscription/.dev.vars'),`SETUP_TOKEN=${secrets.SETUP_TOKEN}\n`);}
 let url='http://127.0.0.1:8790';
 if(!local){
  const out=await wrangler(['deploy','--config',configPath]);
  url=out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/)?.[0];
  if(!url)throw new Error('Deploy สำเร็จแต่ไม่พบ workers.dev URL โปรดตรวจ Cloudflare');
  await wrangler(['secret','bulk','--config',configPath],JSON.stringify(secrets));
  const customDomain=config.routes?.find(route=>route.custom_domain)?.pattern;
  if(customDomain)url='https://'+customDomain;
 }
 const setupLink=existing.length?url:`${url}/#token=${secrets.SETUP_TOKEN}`;
 await privateWrite(join(privateDir,local?'control-local-setup.txt':'control-setup.txt'),setupLink+'\n');
 console.log('ระบบส่วนกลาง: '+url);
 console.log('บัญชีผู้ดูแล: '+config.vars.ADMIN_EMAIL);
 console.log('ลิงก์ตั้งรหัสผ่านเก็บที่ '+join(privateDir,local?'control-local-setup.txt':'control-setup.txt'));
 if(local)console.log('เปิดด้วย npm run subscription:dev');
}
async function provision(slug){
 if(local)throw new Error('ใช้ integration tests สำหรับลูกค้า local; คำสั่งจัดเตรียมนี้สำหรับ Cloudflare จริง');
 if(!/^[a-z][a-z0-9-]{2,29}$/.test(slug||''))throw new Error('ระบุรหัสลูกค้าที่ลงทะเบียน เช่น npm run subscription:provision -- chiangmai-lab');
 const rows=await query(`SELECT * FROM tenants WHERE slug=${quote(slug)}`);let tenant=rows[0];if(!tenant)throw new Error('ไม่พบลูกค้าในระบบส่วนกลาง');
 if(tenant.provision_status==='ready')throw new Error('ลูกค้ารายนี้พร้อมใช้งานแล้ว ใช้คำสั่ง update เพื่ออัปเดตโค้ด');
 const lease=new Date(Date.now()-15*60000).toISOString(),stamp=new Date().toISOString();
 const claimed=await query(`UPDATE tenants SET provision_status='provisioning',updated_at=${quote(stamp)} WHERE id=${quote(tenant.id)} AND (provision_status IN ('pending','failed') OR (provision_status='provisioning' AND updated_at<${quote(lease)})) RETURNING id;`);
 if(!claimed.length)throw new Error('มีการจัดเตรียมลูกค้านี้อยู่แล้ว รออย่างน้อย 15 นาทีหากกระบวนการเดิมหยุดทำงาน');
 await audit(tenant.id,'PROVISION_STARTED');
 try{
  const dbName='mt-stock-'+slug,workerName='mt-stock-'+slug;
  let dbId=tenant.database_id;
  if(!dbId){
   if(await findDatabase(dbName))throw new Error('มีฐานข้อมูลชื่อนี้อยู่แล้วแต่ไม่ได้ลงทะเบียน หยุดเพื่อป้องกันข้อมูลทับกัน');
   console.log('สร้าง D1 ใหม่: '+dbName);dbId=await createDatabase(dbName);
   await query(`UPDATE tenants SET database_id=${quote(dbId)},database_name=${quote(dbName)},worker_name=${quote(workerName)} WHERE id=${quote(tenant.id)};`);
  }
  if(dbId==='ce9f4e96-cd21-4190-8639-5026c3ea80ba')throw new Error('ห้ามใช้ฐานข้อมูล Medical Trend เดิมสำหรับลูกค้าใหม่');
  const secretPath=join(privateDir,slug+'-secrets.json');let secrets;
  try{secrets=JSON.parse(await readFile(secretPath,'utf8'));}catch{secrets={SESSION_SECRET:token(),SUBSCRIPTION_TOKEN:token(),TENANT_SETUP_TOKEN:token()};await privateWrite(secretPath,JSON.stringify(secrets));}
  await query(`UPDATE tenants SET service_token_hash=${quote(hash(secrets.SUBSCRIPTION_TOKEN))} WHERE id=${quote(tenant.id)};`);
  const generated=tenantConfig({...tenant,worker_name:workerName,database_name:dbName,database_id:dbId});
  const tenantPath=join(privateDir,slug+'.json');await privateWrite(tenantPath,JSON.stringify(generated,null,2)+'\n');
  console.log('สร้างตารางฐานข้อมูลเฉพาะลูกค้า');await wrangler(['d1','migrations','apply',dbName,'--remote','--config',tenantPath]);
  console.log('Deploy Worker เฉพาะลูกค้า');const output=await wrangler(['deploy','--config',tenantPath]);
  const url=output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/)?.[0];if(!url)throw new Error('ไม่พบ URL หลัง deploy');
  await wrangler(['secret','bulk','--config',tenantPath],JSON.stringify(secrets));
  const now=new Date().toISOString();
  const duration=(tenant.trial_days||14)*86400000;
  const trialEnd=new Date(Date.now()+duration).toISOString();
  await query(`UPDATE tenants SET provision_status='ready',app_url=${quote(url)},expires_at=${quote(trialEnd)},updated_at=${quote(now)},version=version+1 WHERE id=${quote(tenant.id)};`);
  let health;
  // New workers.dev routes and secrets may take a short time to propagate.
  for(let attempt=0;attempt<10;attempt++){
   try{health=await fetch(url+'/api/me',{signal:AbortSignal.timeout(10000)});if(health.status===401)break;}catch{}
   await new Promise(resolve=>setTimeout(resolve,3000));
  }
  if(health?.status!==401)throw new Error('Worker deploy แล้วแต่ตรวจสิทธิ์บริการไม่ผ่าน (HTTP '+(health?.status||'network error')+')');
  await audit(tenant.id,'PROVISIONED',{database_id:dbId,worker_name:workerName});
  await privateWrite(join(privateDir,slug+'-setup.txt'),url+'/setup.html#token='+secrets.TENANT_SETUP_TOKEN+'\n');
  console.log('พื้นที่ลูกค้าพร้อม: '+url);
  console.log('ลิงก์ให้ลูกค้าตั้งรหัสผ่าน: '+join(privateDir,slug+'-setup.txt'));
 }catch(error){await query(`UPDATE tenants SET provision_status='failed',updated_at=${quote(new Date().toISOString())} WHERE id=${quote(tenant.id)};`).catch(()=>{});await audit(tenant.id,'PROVISION_FAILED',{message:'ดูรายละเอียดในเครื่องผู้ดูแล'}).catch(()=>{});throw error;}
}
async function update(slug){
 if(local)throw new Error('update ใช้กับ Cloudflare จริง');
 if(!/^[a-z][a-z0-9-]{2,29}$/.test(slug||''))throw new Error('กรุณาระบุ slug ลูกค้า');
 const rows=await query(`SELECT * FROM tenants WHERE slug=${quote(slug)}`),tenant=rows[0];
 if(!tenant||tenant.provision_status!=='ready')throw new Error('ลูกค้ายังไม่พร้อมใช้งาน');
 if(tenant.database_id==='ce9f4e96-cd21-4190-8639-5026c3ea80ba'||tenant.worker_name!=='mt-stock-'+slug)throw new Error('ชื่อ Worker หรือฐานข้อมูลไม่ใช่พื้นที่ลูกค้าที่ระบบนี้จัดการ');
 const path=join(privateDir,slug+'.json');await privateWrite(path,JSON.stringify(tenantConfig(tenant),null,2)+'\n');
 await wrangler(['d1','migrations','apply',tenant.database_name,'--remote','--config',path]);
 await wrangler(['deploy','--config',path]);await audit(tenant.id,'WORKER_UPDATED');console.log('อัปเดต '+slug+' สำเร็จ');
}
async function backup(slug){
 if(!/^[a-z][a-z0-9-]{2,29}$/.test(slug||''))throw new Error('กรุณาระบุ slug ลูกค้า');
 const tenant=(await query(`SELECT * FROM tenants WHERE slug=${quote(slug)}`))[0];
 if(!tenant||tenant.provision_status!=='ready')throw new Error('ลูกค้ายังไม่พร้อมใช้งาน');
 if(tenant.worker_name!=='mt-stock-'+slug)throw new Error('Worker ไม่ใช่พื้นที่ลูกค้าที่ระบบนี้จัดการ');
 const path=join(privateDir,slug+'.json');await privateWrite(path,JSON.stringify(tenantConfig(tenant),null,2)+'\n');
 const backupPath=join(privateDir,slug+'-backup-'+new Date().toISOString().replaceAll(':','-')+'.sql');
 await wrangler(['d1','export',tenant.database_name,'--config',path,local?'--local':'--remote','--output',backupPath]);await chmod(backupPath,0o600);
 await audit(tenant.id,'DATABASE_BACKUP');console.log('สำรองข้อมูลไว้ที่ '+backupPath);
}
try{
 if(command==='init')await init();else if(command==='provision')await provision(args.find(a=>!a.startsWith('--')));else if(command==='update')await update(args.find(a=>!a.startsWith('--')));
 else if(command==='backup')await backup(args.find(a=>!a.startsWith('--')));
 else throw new Error('ใช้ init [--local] | provision <slug> | update <slug> | backup <slug>');
}catch(error){console.error(error.message);process.exitCode=1;}
