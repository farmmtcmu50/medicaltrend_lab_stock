const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export async function resolveSupplier(env,body,previous=null){
 const row=body.supplier_id?await env.DB.prepare('SELECT * FROM suppliers WHERE supplier_id=?').bind(String(body.supplier_id)).first():body.supplier?await env.DB.prepare('SELECT * FROM suppliers WHERE name=? COLLATE NOCASE').bind(String(body.supplier).trim()).first():null;
 if(!row||row.is_placeholder)throw fail('กรุณาเลือก Supplier จากทะเบียนก่อนบันทึกน้ำยา');
 if(!row.is_active&&row.supplier_id!==previous)throw fail('Supplier นี้ปิดใช้งานแล้ว กรุณาเลือกรายที่เปิดใช้งาน');
 return {supplier_id:row.supplier_id,supplier:row.name};
}
export async function supplierApi(request,env,user,helpers){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(method==='GET'&&path==='/api/suppliers'){
  if(url.searchParams.get('master')==='1')return {ok:true,rows:(await env.DB.prepare('SELECT * FROM suppliers ORDER BY is_placeholder DESC,is_active DESC,name').all()).results};
  const q='%'+(url.searchParams.get('q')||'').trim()+'%';
  const rows=await env.DB.prepare(`SELECT v.*,COALESCE(i.item_count,0) item_count,COALESCE(s.stock_items,0) stock_items,COALESCE(s.stock_lots,0) stock_lots FROM suppliers v LEFT JOIN (SELECT supplier_id,COUNT(*) item_count FROM items WHERE is_deleted=0 GROUP BY supplier_id) i ON i.supplier_id=v.supplier_id LEFT JOIN (SELECT supplier_id,COUNT(DISTINCT item_id) stock_items,COUNT(DISTINCT item_id||char(0)||lot||char(0)||expiry_date) stock_lots FROM stock_units WHERE status='IN_STOCK' GROUP BY supplier_id) s ON s.supplier_id=v.supplier_id WHERE v.name LIKE ? OR v.contact_name LIKE ? OR v.phone LIKE ? ORDER BY v.is_placeholder DESC,v.is_active DESC,v.name`).bind(q,q,q).all();
  return {ok:true,rows:rows.results};
 }
 if(method==='GET'&&/^\/api\/suppliers\/[^/]+$/.test(path)){
  const id=decodeURIComponent(path.split('/').at(-1)),supplier=await env.DB.prepare('SELECT * FROM suppliers WHERE supplier_id=?').bind(id).first();
  if(!supplier)throw fail('ไม่พบ Supplier',404);
  const [items,stock,purchased]=await env.DB.batch([
   env.DB.prepare("SELECT item_id,reagent_name,machine,main_unit,sub_unit,is_active FROM items WHERE supplier_id=? AND is_deleted=0 ORDER BY reagent_name").bind(id),
   env.DB.prepare("SELECT item_id,reagent_name,machine,lot,expiry_date,sub_unit,COUNT(*) quantity,MIN(supplier_verified) verified FROM stock_units WHERE supplier_id=? AND status='IN_STOCK' GROUP BY item_id,reagent_name,machine,lot,expiry_date,sub_unit ORDER BY expiry_date,reagent_name").bind(id),
   env.DB.prepare("SELECT item_id,reagent_name,machine,sub_unit,COUNT(*) received_qty,MIN(supplier_verified) verified FROM stock_units WHERE supplier_id=? AND status<>'VOID' GROUP BY item_id,reagent_name,machine,sub_unit ORDER BY reagent_name").bind(id)
  ]);
  return {ok:true,supplier,items:items.results,stock:stock.results,purchased:purchased.results};
 }
 if(!['POST','PUT'].includes(method))throw fail('Method not allowed',405);
 if(user.role!=='admin')throw fail('ต้องใช้สิทธิ์ผู้ดูแลเพื่อแก้ไขทะเบียน Supplier',403);
 const body=await helpers.readBody(request),id=method==='POST'?crypto.randomUUID():decodeURIComponent(path.split('/').at(-1));
 const before=method==='PUT'?await env.DB.prepare('SELECT * FROM suppliers WHERE supplier_id=?').bind(id).first():null;
 if(method==='PUT'&&!before)throw fail('ไม่พบ Supplier',404);
 if(before?.is_placeholder)throw fail('ทะเบียนรอระบุ Supplier ใช้สำหรับข้อมูลเดิมเท่านั้น');
 const data={};for(const key of ['name','contact_name','phone','email','address','note']){data[key]=String(body[key]||'').trim();if(data[key].length>(key==='address'||key==='note'?1000:200))throw fail('ข้อมูล Supplier ยาวเกินกำหนด');}
 if(!data.name)throw fail('กรุณาระบุชื่อ Supplier');
 if(data.name==='ยังไม่ระบุ Supplier (ข้อมูลเดิม)')throw fail('ชื่อนี้สงวนไว้สำหรับข้อมูลเดิม');
 const active=Number(body.is_active??1);if(![0,1].includes(active))throw fail('สถานะไม่ถูกต้อง');
 const duplicate=await env.DB.prepare('SELECT supplier_id FROM suppliers WHERE name=? COLLATE NOCASE AND supplier_id<>?').bind(data.name,id).first();if(duplicate)throw fail('มีชื่อ Supplier นี้ในทะเบียนแล้ว',409);
 const time=new Date().toISOString();
 try{
 await env.DB.batch([
  method==='POST'?env.DB.prepare('INSERT INTO suppliers(supplier_id,name,contact_name,phone,email,address,note,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,data.name,data.contact_name,data.phone,data.email,data.address,data.note,active,time,time):env.DB.prepare('UPDATE suppliers SET name=?,contact_name=?,phone=?,email=?,address=?,note=?,is_active=?,updated_at=? WHERE supplier_id=?').bind(data.name,data.contact_name,data.phone,data.email,data.address,data.note,active,time,id),
  env.DB.prepare('UPDATE items SET supplier=?,updated_at=?,updated_by=? WHERE supplier_id=?').bind(data.name,time,user.username,id)
 ]);
 }catch(e){if(/UNIQUE/.test(e.message))throw fail('มีชื่อ Supplier นี้ในทะเบียนแล้ว',409);throw e;}
 await helpers.logAudit(env,user.username,method==='POST'?'CREATE_SUPPLIER':'UPDATE_SUPPLIER','supplier',id,'SUCCESS',{before,after:data,is_active:active});
 return {ok:true,supplier_id:id};
}
