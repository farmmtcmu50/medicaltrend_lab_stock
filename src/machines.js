const UNASSIGNED='ไม่กำหนดเครื่อง';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export async function resolveMachine(env,body,previous=null){
 const name=String(body.machine??'Manual').trim();
 const row=await env.DB.prepare('SELECT * FROM machines WHERE name=? COLLATE NOCASE').bind(name).first();
 if(!row)throw fail('กรุณาเลือกเครื่องตรวจวิเคราะห์จากทะเบียนเครื่อง');
 if(!row.is_active&&row.name!==previous)throw fail('เครื่องนี้ปิดใช้งานแล้ว กรุณาเลือกเครื่องที่เปิดใช้งาน');
 return {machine:row.name};
}
export async function machineApi(request,env,user,{readBody}){
 const path=new URL(request.url).pathname,method=request.method;
 if(method==='GET'&&path==='/api/machines')return {ok:true,rows:(await env.DB.prepare('SELECT m.*, (SELECT COUNT(*) FROM items i WHERE i.machine=m.name COLLATE NOCASE AND i.is_deleted=0) item_count FROM machines m ORDER BY m.is_active DESC,m.name COLLATE NOCASE').all()).results};
 if(user.role!=='admin')throw fail('ต้องใช้สิทธิ์ Admin เพื่อจัดการทะเบียนเครื่อง',403);
 const id=path.split('/')[3],before=id?await env.DB.prepare('SELECT * FROM machines WHERE machine_id=?').bind(id).first():null;
 if(before&&(before.machine_id==='MCH-UNASSIGNED'||before.name===UNASSIGNED))throw fail('ไม่สามารถแก้ไขหรือลบกลุ่มไม่กำหนดเครื่อง',400);
 if(method==='DELETE'){
  if(!before)return {ok:true,already_deleted:true};
  const stamp=new Date().toISOString(),operationId=crypto.randomUUID();
  await env.DB.batch([
   env.DB.prepare('INSERT INTO workflow_guards(operation_id,ok) VALUES(?,(SELECT COUNT(*)=1 FROM machines WHERE machine_id=? AND name=?))').bind(operationId,id,before.name),
   env.DB.prepare('INSERT OR IGNORE INTO machines(machine_id,name,is_active,created_at,updated_at) VALUES(?,?,1,?,?)').bind('MCH-UNASSIGNED',UNASSIGNED,stamp,stamp),
   env.DB.prepare('UPDATE machines SET is_active=1 WHERE name=?').bind(UNASSIGNED),
   env.DB.prepare("INSERT INTO audit_logs(audit_id,timestamp,username,action,target_type,target_id,result,details) SELECT ?,?,?,'DELETE_MACHINE','machine',?,'SUCCESS',json_object('before',json(?),'target',?,'moved_items',(SELECT COUNT(*) FROM items WHERE machine=? COLLATE NOCASE),'moved_units',(SELECT COUNT(*) FROM stock_units WHERE machine=? COLLATE NOCASE),'moved_packages',(SELECT COUNT(*) FROM package_barcodes WHERE machine=? COLLATE NOCASE))").bind(operationId,stamp,user.username,id,JSON.stringify(before),UNASSIGNED,before.name,before.name,before.name),
   env.DB.prepare('UPDATE items SET machine=?,updated_at=?,updated_by=? WHERE machine=? COLLATE NOCASE').bind(UNASSIGNED,stamp,user.username,before.name),
   env.DB.prepare('UPDATE stock_units SET machine=? WHERE machine=? COLLATE NOCASE').bind(UNASSIGNED,before.name),
   env.DB.prepare('UPDATE package_barcodes SET machine=? WHERE machine=? COLLATE NOCASE').bind(UNASSIGNED,before.name),
   env.DB.prepare('DELETE FROM machines WHERE machine_id=?').bind(id),
   env.DB.prepare('DELETE FROM workflow_guards WHERE operation_id=?').bind(operationId)
  ]);
  return {ok:true,moved_to:UNASSIGNED};
 }
 if(method!=='POST'&&method!=='PUT')throw fail('ไม่พบคำสั่ง',404);
 if(method==='PUT'&&!before)throw fail('ไม่พบเครื่อง',404);
 const body=await readBody(request),name=String(body.name||'').trim().replace(/\s+/g,' ');
 if(!name||name.length>100)throw fail('ระบุชื่อเครื่องไม่เกิน 100 ตัวอักษร');
 const duplicate=await env.DB.prepare('SELECT machine_id FROM machines WHERE name=? COLLATE NOCASE').bind(name).first();
 if(duplicate&&duplicate.machine_id!==id)throw fail('มีชื่อเครื่องนี้ในทะเบียนแล้ว กรุณาเลือกจากรายการเดิม',409);
 const machineId=before?.machine_id||'MCH-'+crypto.randomUUID(),stamp=new Date().toISOString(),active=body.is_active===0?0:1;
 const statements=[before?env.DB.prepare('UPDATE machines SET name=?,is_active=?,updated_at=? WHERE machine_id=?').bind(name,active,stamp,machineId):env.DB.prepare('INSERT INTO machines(machine_id,name,is_active,created_at,updated_at) VALUES(?,?,?,?,?)').bind(machineId,name,active,stamp,stamp)];
 if(before&&before.name!==name){
  statements.push(env.DB.prepare('UPDATE items SET machine=?,updated_at=?,updated_by=? WHERE machine=? COLLATE NOCASE').bind(name,stamp,user.username,before.name));
  for(const table of ['stock_units','package_barcodes'])statements.push(env.DB.prepare(`UPDATE ${table} SET machine=? WHERE machine=? COLLATE NOCASE AND status='IN_STOCK'`).bind(name,before.name));
 }
 statements.push(env.DB.prepare('INSERT INTO audit_logs(audit_id,timestamp,username,action,target_type,target_id,result,details) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),stamp,user.username,before?'UPDATE_MACHINE':'ADD_MACHINE','machine',machineId,'SUCCESS',JSON.stringify({before,after:{name,is_active:active}})));
 try{await env.DB.batch(statements);}catch(error){if(String(error).includes('UNIQUE'))throw fail('มีชื่อเครื่องนี้แล้ว',409);throw error;}
 return {ok:true,machine_id:machineId};
}
