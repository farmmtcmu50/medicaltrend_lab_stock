import {digest,equal,fail,passwordHash,randomToken,validatePassword} from '../subscription/src/security.js';

export async function subscriptionGate(request,env){
  if(!env.TENANT_ID)return null; // Existing Medical Trend deployment stays independent.
  if(!env.SESSION_SECRET||!env.SUBSCRIPTION_TOKEN||!env.SUBSCRIPTIONS)throw fail('ยังไม่ได้ตั้งค่าบริการลูกค้า',503);
  let response;
  try {response=await env.SUBSCRIPTIONS.fetch('https://control.internal/internal/subscription',{
    method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${env.SUBSCRIPTION_TOKEN}`},
    body:JSON.stringify({tenant_id:env.TENANT_ID}),signal:AbortSignal.timeout(5000),
  });}catch{throw fail('ไม่สามารถตรวจสอบสิทธิ์บริการได้ กรุณาลองใหม่',503);}
  if(!response.ok)throw fail('ไม่สามารถยืนยันสิทธิ์บริการได้',503);
  const result=await response.json();
  if(result.tenant_id!==env.TENANT_ID||!result.ready)throw fail('พื้นที่ลูกค้ายังไม่พร้อมใช้งาน',503);
  if(result.status==='suspended')throw fail('บริการถูกระงับ กรุณาติดต่อผู้ให้บริการ',403);
  const url=new URL(request.url);
  if(request.method==='POST'&&['/api/login','/api/tenant/setup'].includes(url.pathname)){
    const now=Math.floor(Date.now()/1000),key=await digest(url.pathname+':'+(request.headers.get('cf-connecting-ip')||'local'));
    const limit=await env.DB.prepare(`INSERT INTO tenant_auth_attempts(key,attempts,resets_at) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN resets_at<=? THEN 1 ELSE attempts+1 END,
      resets_at=CASE WHEN resets_at<=? THEN ? ELSE resets_at END RETURNING attempts`).bind(key,now+900,now,now,now+900).first();
    if(limit.attempts>30)throw fail('ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที',429);
    await env.DB.prepare('DELETE FROM tenant_auth_attempts WHERE resets_at<?').bind(now-86400).run();
  }
  const permittedReadPost=['/api/login','/api/logout','/api/labels','/api/consume/preview'];
  const securityChange=request.method==='PUT'&&url.pathname==='/api/me/password';
  if(result.status==='expired' && !['GET','HEAD','OPTIONS'].includes(request.method) && !permittedReadPost.includes(url.pathname) && !securityChange){
    throw fail('Subscription หมดอายุ: ดูและส่งออกข้อมูลได้ แต่ไม่สามารถเพิ่มหรือแก้ไขข้อมูล กรุณาติดต่อเพื่อต่ออายุ',402);
  }
  return result;
}

export async function tenantSetup(request,env){
  if(!env.TENANT_ID||!env.TENANT_SETUP_TOKEN)throw fail('ไม่พบหน้าตั้งค่า',404);
  if(request.method!=='POST')throw fail('Method not allowed',405);
  if(request.headers.get('origin')!==new URL(request.url).origin)throw fail('Origin ไม่ถูกต้อง',403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw fail('ต้องส่ง JSON',415);
  const data=await request.text();if(data.length>2048)throw fail('ข้อมูลใหญ่เกินไป',413);
  const b=JSON.parse(data);
  if(!equal(await digest(String(b.token||'')),await digest(env.TENANT_SETUP_TOKEN)))throw fail('รหัสเปิดใช้งานไม่ถูกต้อง',403);
  validatePassword(b.password);
  if(await env.DB.prepare('SELECT user_id FROM users LIMIT 1').first())throw fail('ตั้งค่าบัญชีแล้ว กรุณาเข้าสู่ระบบ',409);
  const salt=randomToken(),now=new Date().toISOString();
  const inserted=await env.DB.prepare(`INSERT OR IGNORE INTO users(user_id,username,password_hash,salt,role,is_active,created_at,updated_at) VALUES ('initial-admin','admin',?,?,'admin',1,?,?)`).bind(await passwordHash(b.password,salt),salt,now,now).run();
  if(!inserted.meta.changes)throw fail('ตั้งค่าบัญชีแล้ว',409);
  return new Response(JSON.stringify({ok:true}),{headers:{'content-type':'application/json','cache-control':'no-store'}});
}
