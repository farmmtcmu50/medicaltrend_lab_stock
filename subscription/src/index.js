import {iso,id,randomToken,digest,equal,passwordHash,fail,validatePassword,effectiveStatus,addMonths,publicTenant} from './security.js';

const COOKIE = 'mt_control_session';
const SAFE = new Set(['GET','HEAD','OPTIONS']);
const headers = {
  'cache-control':'no-store', 'x-content-type-options':'nosniff', 'referrer-policy':'no-referrer',
  'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const json = (value, status=200, extra={}) => new Response(JSON.stringify(value), {status,headers:{...headers,'content-type':'application/json; charset=utf-8',...extra}});
function cookie(request, token, maxAge=28800) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
}
async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw fail('ต้องส่ง JSON',415);
  const text=await request.text(); if(text.length>16384) throw fail('ข้อมูลใหญ่เกินไป',413);
  try { const value=JSON.parse(text); if(!value||typeof value!=='object'||Array.isArray(value))throw 0; return value; } catch { throw fail('JSON ไม่ถูกต้อง'); }
}
const email = value => {
  const result=String(value||'').trim().toLowerCase();
  if(result.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))throw fail('อีเมลไม่ถูกต้อง');
  return result;
};
function text(value,label,max=160){const s=String(value||'').trim();if(!s||s.length>max)throw fail(`กรุณากรอก${label} ไม่เกิน ${max} ตัวอักษร`);return s;}
function event(db,tenant,actor,action,details={}) {
  return db.prepare('INSERT INTO audit_events (id,tenant_id,actor,action,details,created_at) VALUES (?,?,?,?,?,?)').bind(id(),tenant,actor,action,JSON.stringify(details),iso());
}
async function throttle(db,key,limit) {
  const now=Math.floor(Date.now()/1000);
  const row=await db.prepare(`INSERT INTO auth_attempts(key,attempts,resets_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN resets_at<=? THEN 1 ELSE attempts+1 END,
    resets_at=CASE WHEN resets_at<=? THEN ? ELSE resets_at END RETURNING attempts`).bind(key,now+900,now,now,now+900).first();
  if(row.attempts>limit)throw fail('ลองหลายครั้งเกินไป กรุณารอ 15 นาที',429);
}
async function admin(request,db){
  const token=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(!token || !/^[a-f0-9]{64}$/.test(token))throw fail('กรุณาเข้าสู่ระบบผู้ดูแลส่วนกลาง',401);
  const row=await db.prepare('SELECT a.id,a.email FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>?').bind(await digest(token),iso()).first();
  if(!row)throw fail('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่',401);
  return row;
}
async function tenantById(db,tid){const row=await db.prepare('SELECT * FROM tenants WHERE id=?').bind(tid).first();if(!row)throw fail('ไม่พบลูกค้า',404);return row;}
async function planById(db,pid){const row=await db.prepare('SELECT * FROM plans WHERE id=? AND active=1').bind(pid).first();if(!row)throw fail('ไม่พบแพ็กเกจที่เปิดใช้งาน');return row;}

export default {async fetch(request,env){
  try {
    const url=new URL(request.url),db=env.CONTROL_DB,path=url.pathname;
    if(!db)throw fail('ยังไม่ได้ตั้งค่าฐานข้อมูลส่วนกลาง',503);
    if(path==='/internal/subscription'){
      if(request.method!=='POST')throw fail('Method not allowed',405);
      const b=await body(request),tenant=await tenantById(db,String(b.tenant_id||''));
      const token=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
      if(!tenant.service_token_hash || !equal(await digest(token),tenant.service_token_hash))throw fail('Unauthorized',401);
      return json({ok:true,tenant_id:tenant.id,name:tenant.name,status:effectiveStatus(tenant),expires_at:tenant.expires_at,ready:tenant.provision_status==='ready'});
    }
    if(!path.startsWith('/api/')){
      if(!['GET','HEAD'].includes(request.method))throw fail('Method not allowed',405);
      const response=await env.ASSETS.fetch(request);const h=new Headers(response.headers);for(const [k,v]of Object.entries(headers))h.set(k,v);
      return new Response(response.body,{status:response.status,headers:h});
    }
    if(!SAFE.has(request.method) && request.headers.get('origin')!==url.origin)throw fail('Origin ไม่ถูกต้อง',403);
    if(path==='/api/status' && request.method==='GET')return json({ok:true,setup_required:!(await db.prepare("SELECT id FROM admins WHERE id='owner'").first()),admin_email:env.ADMIN_EMAIL});
    if(path==='/api/setup' && request.method==='POST'){
      await throttle(db,'setup:'+await digest(request.headers.get('cf-connecting-ip')||'local'),10);
      const b=await body(request);
      if(!env.SETUP_TOKEN||!equal(await digest(String(b.token||'')),await digest(env.SETUP_TOKEN)))throw fail('รหัสตั้งค่าครั้งแรกไม่ถูกต้อง',403);
      validatePassword(b.password);const salt=randomToken();
      try { await db.batch([db.prepare("INSERT INTO admins(id,email,password_hash,salt,created_at) VALUES ('owner',?,?,?,?)").bind(email(env.ADMIN_EMAIL),await passwordHash(b.password,salt),salt,iso()),event(db,null,env.ADMIN_EMAIL,'OWNER_CREATED')]); }
      catch(e){if(String(e.message).includes('UNIQUE'))throw fail('ระบบตั้งค่าผู้ดูแลแล้ว',409);throw e;}
      return json({ok:true});
    }
    if(path==='/api/login' && request.method==='POST'){
      const b=await body(request),address=email(b.email);
      await throttle(db,'ip:'+await digest(request.headers.get('cf-connecting-ip')||'local'),30);
      await throttle(db,'email:'+await digest(address),10);
      const user=await db.prepare('SELECT * FROM admins WHERE email=?').bind(address).first();
      const hash=await passwordHash(String(b.password||'').slice(0,129),user?.salt||'invalid-user-salt');
      if(!user || !equal(hash,user.password_hash))throw fail('อีเมลหรือรหัสผ่านไม่ถูกต้อง',401);
      const token=randomToken();await db.batch([db.prepare('INSERT INTO sessions VALUES (?,?,?)').bind(await digest(token),user.id,new Date(Date.now()+28800000).toISOString()),db.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(iso()),db.prepare('DELETE FROM auth_attempts WHERE resets_at<?').bind(Math.floor(Date.now()/1000)-86400),event(db,null,address,'LOGIN')]);
      return json({ok:true,email:address},200,{'set-cookie':cookie(request,token)});
    }
    const user=await admin(request,db);
    if(path==='/api/me' && request.method==='GET')return json({ok:true,user});
    if(path==='/api/logout' && request.method==='POST'){
      const token=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
      await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(token)).run();return json({ok:true},200,{'set-cookie':cookie(request,'',0)});
    }
    if(path==='/api/password' && request.method==='PUT'){
      const b=await body(request);validatePassword(b.password);
      const current=await db.prepare('SELECT * FROM admins WHERE id=?').bind(user.id).first();
      await throttle(db,'password:'+user.id,10);
      if(!equal(await passwordHash(String(b.current_password||''),current.salt),current.password_hash))throw fail('รหัสผ่านเดิมไม่ถูกต้อง',403);
      const salt=randomToken();await db.batch([db.prepare('UPDATE admins SET password_hash=?,salt=? WHERE id=?').bind(await passwordHash(b.password,salt),salt,user.id),db.prepare('DELETE FROM sessions WHERE admin_id=?').bind(user.id),event(db,null,user.email,'PASSWORD_CHANGED')]);
      return json({ok:true},200,{'set-cookie':cookie(request,'',0)});
    }
    if(path==='/api/plans' && request.method==='GET')return json({ok:true,rows:(await db.prepare('SELECT * FROM plans ORDER BY monthly_price_satang,id').all()).results});
    if(path.startsWith('/api/plans/') && request.method==='PUT'){
      const pid=path.split('/')[3],b=await body(request),name=text(b.name,'ชื่อแพ็กเกจ',80);
      if(!Number.isSafeInteger(b.monthly_price_satang)||b.monthly_price_satang<0||b.monthly_price_satang>100000000)throw fail('ราคาแพ็กเกจไม่ถูกต้อง');
      const result=await db.batch([db.prepare('UPDATE plans SET name=?,monthly_price_satang=?,description=? WHERE id=?').bind(name,b.monthly_price_satang,String(b.description||'').slice(0,500),pid),event(db,null,user.email,'PLAN_UPDATED',{plan_id:pid,monthly_price_satang:b.monthly_price_satang})]);
      if(!result[0].meta.changes)throw fail('ไม่พบแพ็กเกจ',404);return json({ok:true});
    }
    if(path==='/api/tenants' && request.method==='GET')return json({ok:true,rows:(await db.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all()).results.map(publicTenant)});
    if(path==='/api/tenants' && request.method==='POST'){
      const b=await body(request),slug=String(b.slug||'').trim().toLowerCase();
      if(!/^[a-z][a-z0-9-]{2,29}$/.test(slug)||slug.endsWith('-'))throw fail('รหัสลูกค้าใช้ a–z, 0–9 และขีดกลาง ความยาว 3–30 ตัว เริ่มด้วยตัวอักษร');
      if(['admin','api','www','stock','medicaltrend','subscriptions'].includes(slug))throw fail('รหัสลูกค้านี้สงวนไว้');
      const plan=await planById(db,b.plan_id),tid=id(),now=iso();
      const days=Number(b.trial_days??14);if(!Number.isInteger(days)||days<1||days>90)throw fail('วันทดลองใช้ต้องอยู่ระหว่าง 1–90 วัน');
      const until=new Date(Date.now()+days*86400000).toISOString();
      try{await db.batch([db.prepare(`INSERT INTO tenants(id,slug,name,contact_email,plan_id,status,expires_at,created_at,updated_at,trial_days) VALUES (?,?,?,?,?,'trial',?,?,?,?)`).bind(tid,slug,text(b.name,'ชื่อลูกค้า'),email(b.contact_email),plan.id,until,now,now,days),event(db,tid,user.email,'TENANT_CREATED',{slug,plan_id:plan.id,trial_days:days})]);}
      catch(e){if(String(e.message).includes('UNIQUE'))throw fail('รหัสลูกค้านี้มีอยู่แล้ว',409);throw e;}
      return json({ok:true,tenant:publicTenant(await tenantById(db,tid))},201);
    }
    const match=path.match(/^\/api\/tenants\/([a-f0-9-]+)(?:\/(renew|status))?$/);
    if(match){
      const tenant=await tenantById(db,match[1]);
      if(request.method==='GET'&&!match[2]){
        const [payments,events]=await Promise.all([db.prepare('SELECT * FROM payments WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100').bind(tenant.id).all(),db.prepare('SELECT * FROM audit_events WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100').bind(tenant.id).all()]);
        return json({ok:true,tenant:publicTenant(tenant),payments:payments.results,events:events.results});
      }
      if(request.method==='POST'&&match[2]==='renew'){
        const b=await body(request),key=text(b.request_key,'รหัสรายการ',80);
        const existing=await db.prepare('SELECT * FROM payments WHERE request_key=?').bind(key).first();
        if(existing){if(existing.tenant_id!==tenant.id)throw fail('รหัสรายการซ้ำ',409);return json({ok:true,payment:existing,tenant:publicTenant(tenant),duplicate:true});}
        if(tenant.status==='suspended')throw fail('กรุณาเปิดบริการก่อนบันทึกต่ออายุ',409);
        if(tenant.provision_status!=='ready')throw fail('ต้องจัดเตรียมฐานข้อมูลและพื้นที่ลูกค้าให้พร้อมก่อนรับชำระ',409);
        if(b.version!==tenant.version)throw fail('ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดใหม่',409);
        if(!Number.isInteger(b.months)||b.months<1||b.months>36)throw fail('จำนวนเดือนต้องเป็น 1–36');
        if(!Number.isSafeInteger(b.amount_satang)||b.amount_satang<=0||b.amount_satang>100000000)throw fail('ยอดรับชำระต้องมากกว่า 0 และไม่เกิน 1,000,000 บาท');
        const plan=await planById(db,b.plan_id),reference=text(b.reference,'เลขอ้างอิงการโอน',200);
        const start=new Date(tenant.expires_at)>new Date()?tenant.expires_at:iso(),end=addMonths(start,b.months),pid=id(),now=iso();
        const result=await db.batch([
          db.prepare(`INSERT OR IGNORE INTO payments(id,tenant_id,request_key,amount_satang,months,reference,starts_at,ends_at,plan_id,recorded_by,created_at)
            SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM tenants WHERE id=? AND version=?)`).bind(pid,tenant.id,key,b.amount_satang,b.months,reference,start,end,plan.id,user.email,now,tenant.id,tenant.version),
          db.prepare(`UPDATE tenants SET status='active',plan_id=?,expires_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM payments WHERE id=?)`).bind(plan.id,end,now,tenant.id,tenant.version,pid),
          db.prepare(`INSERT INTO audit_events SELECT ?,?,?,?, ?,? WHERE EXISTS(SELECT 1 FROM payments WHERE id=?)`).bind(id(),tenant.id,user.email,'PAYMENT_RECORDED',JSON.stringify({payment_id:pid,amount_satang:b.amount_satang,months:b.months,ends_at:end}),now,pid)
        ]);
        if(!result[0].meta.changes){
          const previous=await db.prepare('SELECT * FROM payments WHERE request_key=?').bind(key).first();
          if(previous?.tenant_id===tenant.id)return json({ok:true,payment:previous,tenant:publicTenant(await tenantById(db,tenant.id)),duplicate:true});
          throw fail('ข้อมูลเปลี่ยนระหว่างบันทึก กรุณาโหลดใหม่',409);
        }
        return json({ok:true,tenant:publicTenant(await tenantById(db,tenant.id))});
      }
      if(request.method==='POST'&&match[2]==='status'){
        const b=await body(request);if(!['active','suspended'].includes(b.status))throw fail('สถานะไม่ถูกต้อง');
        const reason=text(b.reason,'เหตุผล',500);
        const next=b.status==='suspended'?'suspended':tenant.status==='suspended'?(await db.prepare('SELECT id FROM payments WHERE tenant_id=? LIMIT 1').bind(tenant.id).first()?'active':'trial'):tenant.status;
        const results=await db.batch([db.prepare('UPDATE tenants SET status=?,updated_at=?,version=version+1 WHERE id=? AND version=?').bind(next,iso(),tenant.id,b.version),db.prepare(`INSERT INTO audit_events SELECT ?,?,?,?,?,? WHERE changes()=1`).bind(id(),tenant.id,user.email,'STATUS_CHANGED',JSON.stringify({status:next,reason}),iso())]);
        if(!results[0].meta.changes)throw fail('ข้อมูลเปลี่ยนแปลง กรุณาโหลดใหม่',409);return json({ok:true,tenant:publicTenant(await tenantById(db,tenant.id))});
      }
    }
    throw fail('ไม่พบรายการ',404);
  }catch(error){
    if(!error.status)console.error('Control API:',error);
    return json({ok:false,error:error.status?error.message:'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่'},error.status||500);
  }
}};
