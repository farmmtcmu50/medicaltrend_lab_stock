// Stock changes, their exact QR membership, audit and replay response commit together.
const timestamp = () => new Date().toISOString();
const uid = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const fail = (message, status=400) => Object.assign(new Error(message), {status});
const integer = (value, label, min=1, max=2000) => {
 const n=Number(value); if(!Number.isSafeInteger(n)||n<min||n>max) throw fail(`${label}ต้องเป็นจำนวนเต็ม ${min}–${max}`); return n;
};
const reason = (value) => {const s=String(value||'').trim();if(s.length<3||s.length>500)throw fail('กรุณาระบุเหตุผล 3–500 ตัวอักษร');return s;};
const date = (s) => {if(!/^\d{4}-\d{2}-\d{2}$/.test(s||'')||!Number.isFinite(new Date(s).getTime())||new Date(s).toISOString().slice(0,10)!==s)throw fail('วันหมดอายุไม่ถูกต้อง');return s;};
async function hash(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export function stockWorkflow(env,user,helpers){
 const db=env.DB, query=(sql,...args)=>db.prepare(sql).bind(...args);
 const publicResult=result=>{
  if(user.role==='admin'||!result.labels)return result;
  return {...result,labels:result.labels.map(label=>{const item={...label.item};delete item.unit_price;delete item.main_unit_price;return {...label,item};})};
 };
 const admin=()=>{if(user.role!=='admin')throw fail('เฉพาะผู้ดูแลระบบ',403);};
 const guard=(id,condition,...args)=>query(`INSERT INTO workflow_guards(operation_id,ok) VALUES (?,CASE WHEN (${condition}) THEN 1 ELSE 0 END)`,id,...args);
 const audit=(id,action,details)=>query(`INSERT INTO audit_logs(audit_id,timestamp,username,action,target_type,target_id,result,details) VALUES (?,?,?,?,'stock_operation',?,'SUCCESS',?)`,uid('AUD'),timestamp(),user.username,action,id,JSON.stringify(details));
 async function begin(body,kind){
  const requestId=body.request_id || uid('legacy');
  if(typeof requestId!=='string'||requestId.length>150)throw fail('รหัสคำขอไม่ถูกต้อง');
  const payloadHash=await hash({body,kind,username:user.username});
  const old=await query('SELECT * FROM stock_operations WHERE request_id=?',requestId).first();
  if(old){if(old.payload_hash!==payloadHash||old.username!==user.username)throw fail('รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว',409);return {replay:{...publicResult(JSON.parse(old.response_json)),replayed:true}};}
  return {id:uid('OP'),requestId,payloadHash,kind};
 }
 async function commit(op,body,statements,result,extra={}){
  const response={ok:true,...result,operation_id:op.id,request_id:op.requestId};
  const record=query(`INSERT INTO stock_operations(operation_id,request_id,username,kind,created_at,item_id,reason,payload_hash,response_json,reverses_id,pr_line_id,pr_quantity) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,op.id,op.requestId,user.username,op.kind,timestamp(),extra.itemId||'',extra.reason||'',op.payloadHash,JSON.stringify(response),extra.reverses||null,extra.prLine||null,extra.prQty||0);
  try{await db.batch([record,...statements,audit(op.id,op.kind,{reason:extra.reason||'',...extra}),query('DELETE FROM workflow_guards WHERE operation_id=?',op.id)]);}
  catch(error){
   const replay=await begin(body,op.kind);if(replay.replay)return replay.replay;
   if(/CHECK|UNIQUE|FOREIGN KEY/.test(error.message))throw fail('ข้อมูลสต๊อกหรือเอกสารเปลี่ยนระหว่างทำรายการ กรุณารีเฟรชและตรวจยอดก่อนลองใหม่',409);
   throw error;
  }
  return response;
 }
 function movement(id,kind,item,lot,qty,note,barcodes){return query(`INSERT INTO movements(movement_id,timestamp,type,barcode,item_id,reagent_name,lot,quantity_sub,operator_note,operator_username,unit) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,id,timestamp(),kind,barcodes.join(','),item.item_id,item.reagent_name,lot,qty,note,user.username,item.sub_unit||item.main_unit||'');}
 function remember(id,row,status){return query('INSERT INTO stock_operation_units(operation_id,barcode,before_json,after_status) VALUES (?,?,?,?)',id,row.barcode,row.before===null?null:JSON.stringify(row),status);}
 function validateUnits(id,units){return units.map(row=>guard(id,`EXISTS(SELECT 1 FROM stock_units WHERE barcode=? AND status=? AND last_operation=?)`,row.barcode,row.status,row.last_operation||''));}
 const snapshotSql=`SELECT COALESCE(group_concat(barcode || ':' || last_operation,'|'),'') AS signature FROM (SELECT barcode,last_operation FROM stock_units WHERE item_id=? AND lot=? AND expiry_date=? AND status='IN_STOCK' ORDER BY barcode)`;
 async function snapshot(itemId,lot,expiry){return (await query(snapshotSql,itemId,lot,expiry).first()).signature;}
 async function activeItem(id){const item=await helpers.getActiveItem(env,id);return Number(item.has_sub_unit)===0?{...item,sub_unit:item.main_unit,sub_per_main:1}:item;}
 function newUnits(op,item,qty,lot,expiry,note){
  const rows=Array.from({length:qty},()=>({barcode:uid('QR'),item_id:item.item_id,reagent_name:item.reagent_name,lot,expiry_date:expiry,machine:item.machine,sub_unit:item.sub_unit,status:'IN_STOCK',received_at:timestamp(),note,parent_barcode:'',received_by:user.username,last_operation:op.id,supplier_id:item.supplier_id,supplier_verified:op.kind==='RECEIVE'?1:0,before:null}));
  return rows;
 }
 function insertUnit(row){return query(`INSERT INTO stock_units(barcode,item_id,reagent_name,lot,expiry_date,machine,sub_unit,status,received_at,note,parent_barcode,received_by,last_operation,supplier_id,supplier_verified) VALUES (?,?,?,?,?,?,?,'IN_STOCK',?,?,?,?,?,?,?)`,row.barcode,row.item_id,row.reagent_name,row.lot,row.expiry_date,row.machine,row.sub_unit,row.received_at,row.note,row.parent_barcode,row.received_by,row.last_operation,row.supplier_id,row.supplier_verified);}
 function labels(rows,item){
  const safeItem={...item};if(user.role!=='admin'){delete safeItem.unit_price;delete safeItem.main_unit_price;}
  return rows.map(row=>({code:row.barcode,type:'sub',sub_count:1,item:safeItem,lot:row.lot,expiry:row.expiry_date}));
 }
 function packageUpdates(parents){return [...new Set(parents.filter(Boolean))].map(parent=>query(`UPDATE package_barcodes SET status=CASE WHEN EXISTS(SELECT 1 FROM stock_units WHERE parent_barcode=? AND status='IN_STOCK') THEN 'IN_STOCK' ELSE 'USED' END WHERE package_barcode=?`,parent,parent));}
 return {
  async status(request){
   const key=new URL(request.url).searchParams.get('request_id');
   const row=await query('SELECT response_json FROM stock_operations WHERE request_id=? AND username=?',key||'',user.username).first();
   return {ok:true,found:!!row,result:row?publicResult(JSON.parse(row.response_json)):null};
  },
  async history(request){
   const params=new URL(request.url).searchParams, [cursor,cursorId]=(params.get('before')||'9999|').split('|');
   const rows=await query(`SELECT o.operation_id,o.request_id,o.username,o.kind,o.created_at,o.item_id,o.reason,o.reverses_id,o.reversed_by,COALESCE((SELECT lot FROM movements m WHERE m.movement_id=o.operation_id),'') AS lot,i.reagent_name,i.sub_unit AS unit,(SELECT COUNT(*) FROM stock_operation_units u WHERE u.operation_id=o.operation_id) AS quantity FROM stock_operations o LEFT JOIN items i ON i.item_id=o.item_id WHERE (o.created_at<? OR (o.created_at=? AND o.operation_id<?)) ORDER BY o.created_at DESC,o.operation_id DESC LIMIT 100`,cursor,cursor,cursorId||'').all();
   return {ok:true,rows:rows.results,next_cursor:rows.results.length===100?rows.results.at(-1).created_at+'|'+rows.results.at(-1).operation_id:null};
  },
  async details(id){return {ok:true,rows:(await query('SELECT u.barcode,u.after_status,s.status AS current_status FROM stock_operation_units u LEFT JOIN stock_units s ON s.barcode=u.barcode WHERE u.operation_id=? ORDER BY u.barcode LIMIT 2000',id).all()).results};},
  async receive(body){
   const op=await begin(body,'RECEIVE');if(op.replay)return op.replay;
   const item=await activeItem(body.item_id), qty=integer(body.quantity,'จำนวน'), lot=String(body.lot||'').trim(),expiry=date(body.expiry_date);
   if(!lot||lot.length>100)throw fail('กรุณาระบุ Lot ไม่เกิน 100 ตัวอักษร');
   if(!item.supplier_id||item.supplier_id==='SUP-UNASSIGNED')throw fail('กรุณาระบุ Supplier ในรายการน้ำยาก่อนรับเข้าคลัง');
   const hasSub=Number(item.has_sub_unit??1)===1;
   const mode=hasSub&&body.unit_mode!=='main'?'sub':'main',factor=hasSub?item.sub_per_main:1;
   const total=integer(qty*(mode==='main'?factor:1),'จำนวนรวม');
   const note=String(body.note||''), rows=newUnits(op,item,total,lot,expiry,note),batch=[];let prQty=0;
   if(body.pr_line_id){
    const line=await query(`SELECT l.*,p.status FROM purchase_requisition_items l JOIN purchase_requisitions p ON p.pr_id=l.pr_id WHERE l.line_id=?`,body.pr_line_id).first();
    if(!line||line.status!=='APPROVED')throw fail('ต้องรับจากใบ PR ที่อนุมัติแล้ว',409);
    if(line.item_id&&line.item_id!==item.item_id)throw fail('สินค้าไม่ตรงกับรายการ PR');
    if(line.supplier_id||String(line.supplier||'').trim()){
     const vendor=await query('SELECT supplier_id FROM suppliers WHERE ((? IS NOT NULL AND supplier_id=?) OR (? IS NULL AND name=? COLLATE NOCASE)) AND is_placeholder=0',line.supplier_id||null,line.supplier_id||null,line.supplier_id||null,String(line.supplier||'').trim()).first();
     if(!vendor)throw fail('Supplier ใน PR ไม่ตรงทะเบียน กรุณาตรวจสอบก่อนรับเข้า');
     item.supplier_id=vendor.supplier_id;rows.forEach(row=>row.supplier_id=vendor.supplier_id);
    }
    const orderFactor=line.unit===item.main_unit?factor:hasSub&&line.unit===item.sub_unit?1:0;
    if(!orderFactor)throw fail('หน่วยใน PR ไม่ตรงกับสินค้า กรุณาตรวจหน่วยก่อนรับ');
    prQty=total/orderFactor;
    if(prQty>Number(line.order_qty)-Number(line.received_qty)+1e-9)throw fail('จำนวนรับเกินยอดค้างรับใน PR',409);
    batch.push(guard(op.id,`EXISTS(SELECT 1 FROM purchase_requisition_items l JOIN purchase_requisitions p ON p.pr_id=l.pr_id WHERE l.line_id=? AND p.status='APPROVED' AND l.received_qty=? AND l.order_qty=? AND l.unit=? AND l.item_id=?)`,line.line_id,line.received_qty,line.order_qty,line.unit,line.item_id));
    batch.push(query("UPDATE purchase_requisition_items SET received_qty=received_qty+?,item_id=CASE WHEN item_id='' THEN ? ELSE item_id END WHERE line_id=?",prQty,item.item_id,line.line_id));
   }
   const printed=[];
   if(hasSub&&body.sticker_mode==='main'){
    for(let offset=0;offset<rows.length;offset+=factor){const group=rows.slice(offset,offset+factor),code=uid('BOX');group.forEach(row=>row.parent_barcode=code);
     batch.push(query(`INSERT INTO package_barcodes(package_barcode,item_id,reagent_name,lot,expiry_date,machine,main_unit,sub_unit,sub_count,status,received_at,note,received_by) VALUES (?,?,?,?,?,?,?,?,?,'IN_STOCK',?,?,?)`,code,item.item_id,item.reagent_name,lot,expiry,item.machine,item.main_unit,item.sub_unit,group.length,timestamp(),note,user.username));
     const label=labels([group[0]],item)[0];printed.push({...label,code,type:'main',sub_count:group.length});
    }
   }else printed.push(...labels(rows,item));
   rows.forEach(row=>batch.push(insertUnit(row),remember(op.id,row,'IN_STOCK')));
   batch.push(movement(op.id,'RECEIVE',item,lot,total,note,printed.map(l=>l.code)));
   return commit(op,body,batch,{labels:printed,total_sub:total,unit:item.sub_unit,item_name:item.reagent_name},{itemId:item.item_id,prLine:body.pr_line_id||null,prQty});
  },
  async consume(body){
   const kind=body.kind==='DISPOSE'?'DISPOSE':'CONSUME',op=await begin(body,kind);if(op.replay)return op.replay;
   if(body.kind&&!['DISPOSE','CONSUME'].includes(body.kind))throw fail('ประเภทการตัดไม่ถูกต้อง');
   const why=kind==='DISPOSE'?reason(body.reason):String(body.note||'');
   const target=await helpers.findStockTarget(env,String(body.barcode||'').trim());
   const qty=target.is_package?integer(body.package_quantity??target.quantity_sub,'จำนวนตัด'):1;
   const warnings=await helpers.fefoWarnings(env,target,qty);
   if(kind==='CONSUME'&&warnings.length&&!body.confirm_fefo)throw fail('พบ Lot ที่ควรใช้ก่อน กรุณาตรวจ FEFO และยืนยันใหม่',409);
   const units=target.is_package?(await query(`SELECT * FROM stock_units WHERE parent_barcode=? AND status='IN_STOCK' ORDER BY expiry_date,received_at,barcode LIMIT ?`,target.barcode,qty).all()).results:[await query('SELECT * FROM stock_units WHERE barcode=?',target.barcode).first()];
   if(units.length!==qty)throw fail('จำนวนคงเหลือไม่พอ',409);
   const status=kind==='DISPOSE'?'DISPOSED':'USED';
   const batch=validateUnits(op.id,units);
   for(const row of units){batch.push(remember(op.id,row,status),query('UPDATE stock_units SET status=?,used_at=?,used_by=?,note=?,last_operation=? WHERE barcode=?',status,timestamp(),user.username,why,op.id,row.barcode));}
   batch.push(...packageUpdates(units.map(u=>u.parent_barcode)),movement(op.id,kind,target,target.lot,qty,why,[target.barcode]));
   if(warnings.length&&kind==='CONSUME')batch.push(audit(op.id,'FEFO_OVERRIDE',warnings));
   const remaining=target.is_package?Number(target.quantity_sub)-qty:target.parent_barcode?Number((await query("SELECT COUNT(*) AS n FROM stock_units WHERE parent_barcode=? AND status='IN_STOCK'",target.parent_barcode).first()).n)-1:0;
   return commit(op,body,batch,{barcode:target.barcode,parent_barcode:target.is_package?'':target.parent_barcode||'',consumed:qty,remaining_sub:remaining,item_name:target.reagent_name,lot:target.lot,unit:target.sub_unit,kind},{itemId:target.item_id,reason:why});
  },
  async reverse(body,id){
   admin();const op=await begin(body,'REVERSAL');if(op.replay)return op.replay;const why=reason(body.reason);
   const original=await query('SELECT * FROM stock_operations WHERE operation_id=?',id).first();
   if(!original||!['RECEIVE','CONSUME','DISPOSE','ADJUSTMENT'].includes(original.kind))throw fail('รายการนี้ไม่รองรับการกลับรายการ',409);
   if(original.reversed_by)throw fail('กลับรายการนี้แล้ว',409);
   const entries=(await query('SELECT * FROM stock_operation_units WHERE operation_id=?',id).all()).results;
   const batch=[guard(op.id,"EXISTS(SELECT 1 FROM stock_operations WHERE operation_id=? AND reversed_by='')",id)],parents=[];
   for(const entry of entries){
    const current=await query('SELECT * FROM stock_units WHERE barcode=?',entry.barcode).first();
    if(!current||current.last_operation!==id||current.status!==entry.after_status)throw fail('QR นี้มีรายการถัดไปแล้ว ไม่สามารถกลับย้อนหลังได้ ให้ตรวจนับและปรับยอดแทน',409);
    batch.push(...validateUnits(op.id,[current]));parents.push(current.parent_barcode);
    const before=entry.before_json?JSON.parse(entry.before_json):null;
    const status=before?before.status:'VOID';
    batch.push(remember(op.id,current,status),query('UPDATE stock_units SET status=?,used_at=?,used_by=?,note=?,last_operation=? WHERE barcode=?',status,before?.used_at||null,before?.used_by||'',before?.note||why,op.id,entry.barcode));
   }
   batch.push(...packageUpdates(parents),query('UPDATE stock_operations SET reversed_by=? WHERE operation_id=?',op.id,id));
   if(original.pr_line_id)batch.push(query('UPDATE purchase_requisition_items SET received_qty=received_qty-? WHERE line_id=?',original.pr_quantity,original.pr_line_id));
   const item=await query('SELECT * FROM items WHERE item_id=?',original.item_id).first();
   if(item)batch.push(movement(op.id,'REVERSAL_'+original.kind,item,'',entries.length,why,entries.map(e=>e.barcode)));
   return commit(op,body,batch,{reversed_operation:id},{itemId:original.item_id,reason:why,reverses:id});
  },
  async lots(itemId){
   const rows=await query("SELECT lot,expiry_date,COUNT(*) AS quantity FROM stock_units WHERE item_id=? AND status='IN_STOCK' GROUP BY lot,expiry_date ORDER BY expiry_date",itemId).all();return {ok:true,rows:rows.results};
  },
  async counts(){return {ok:true,rows:(await query('SELECT c.*,i.reagent_name,i.sub_unit AS unit,o.reversed_by FROM stock_counts c JOIN items i ON i.item_id=c.item_id LEFT JOIN stock_operations o ON o.operation_id=c.operation_id ORDER BY c.created_at DESC LIMIT 100').all()).results};},
  async createCount(body){
   const op=await begin(body,'COUNT_DRAFT');if(op.replay)return op.replay;
   const item=await activeItem(body.item_id),lot=String(body.lot||'').trim(),expiry=date(body.expiry_date),qty=integer(body.counted_qty,'ยอดนับจริง',0,1000000000),why=reason(body.reason);
   if(!lot)throw fail('กรุณาระบุ Lot');
   const signature=await snapshot(item.item_id,lot,expiry),systemQty=Number((await query("SELECT COUNT(*) AS n FROM stock_units WHERE item_id=? AND lot=? AND expiry_date=? AND status='IN_STOCK'",item.item_id,lot,expiry).first()).n),id=uid('COUNT');
   return commit(op,body,[query(`INSERT INTO stock_counts(count_id,created_at,created_by,item_id,lot,expiry_date,snapshot_signature,system_qty,counted_qty,reason) VALUES (?,?,?,?,?,?,?,?,?,?)`,id,timestamp(),user.username,item.item_id,lot,expiry,signature,systemQty,qty,why)],{count_id:id,system_qty:systemQty,counted_qty:qty,difference:qty-systemQty},{itemId:item.item_id,reason:why});
  },
  async approveCount(body,id){
   admin();const op=await begin(body,'ADJUSTMENT');if(op.replay)return op.replay;
   const count=await query('SELECT * FROM stock_counts WHERE count_id=?',id).first();
   if(!count||count.status!=='PENDING')throw fail('ใบตรวจนับนี้ยืนยันไปแล้วหรือไม่พบ',409);
   const item=await activeItem(count.item_id),diff=count.counted_qty-count.system_qty;
   if (Math.abs(diff)>2000) throw fail('ผลต่างเกิน 2000 หน่วย กรุณาติดต่อผู้ดูแลก่อนปรับยอด');
   const batch=[guard(op.id,`EXISTS(SELECT 1 FROM stock_counts WHERE count_id=? AND status='PENDING')`,id),guard(op.id,`(${snapshotSql})=?`,item.item_id,count.lot,count.expiry_date,count.snapshot_signature)];
   let rows=[];
   if(diff>0){rows=newUnits(op,item,integer(diff,'จำนวนเพิ่ม'),count.lot,count.expiry_date,count.reason);for(const row of rows)batch.push(insertUnit(row),remember(op.id,row,'IN_STOCK'));}
   if(diff<0){
    const units=(await query("SELECT * FROM stock_units WHERE item_id=? AND lot=? AND expiry_date=? AND status='IN_STOCK' ORDER BY parent_barcode,barcode LIMIT ?",item.item_id,count.lot,count.expiry_date,-diff).all()).results;
    for(const row of units)batch.push(remember(op.id,row,'ADJUSTED_OUT'),query("UPDATE stock_units SET status='ADJUSTED_OUT',used_at=?,used_by=?,note=?,last_operation=? WHERE barcode=?",timestamp(),user.username,count.reason,op.id,row.barcode));
    batch.push(...packageUpdates(units.map(u=>u.parent_barcode)));
   }
   batch.push(query("UPDATE stock_counts SET status='APPROVED',approved_by=?,approved_at=?,operation_id=? WHERE count_id=?",user.username,timestamp(),op.id,id),movement(op.id,'ADJUSTMENT',item,count.lot,diff,count.reason,rows.map(r=>r.barcode)));
   return commit(op,body,batch,{difference:diff,labels:labels(rows,item),count_id:id},{itemId:item.item_id,reason:count.reason});
  }
 };
}
