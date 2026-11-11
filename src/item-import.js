import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import ExcelJS from 'exceljs/dist/exceljs.min.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const columns=[['reagent_name','ชื่อสินค้า',true],['machine','เครื่อง',true],['supplier','Supplier',true],['main_unit','หน่วยหลัก',true],['has_sub_unit','ใช้หน่วยย่อย (0/1)',true],['sub_unit','หน่วยย่อย',false],['sub_per_main','จำนวนย่อยต่อหลัก',false],['lead_time_days','Lead Time (วัน)',true],['reorder_point_sub','Safety Stock (หน่วยเล็กสุด)',true],['main_unit_price','ราคาต้นทุนต่อหน่วยหลัก (บาท)',false]];
const visibleColumns=user=>columns.filter(([key])=>user.role==='admin'||key!=='main_unit_price');
const text=value=>String(value??'').trim();
const normalized=value=>text(value).toLocaleLowerCase();
const identity=row=>JSON.stringify([row.reagent_name,row.machine,row.supplier].map(normalized));
export async function itemTemplate(env,user){
 const workbook=new ExcelJS.Workbook();workbook.creator='Medical Trend';workbook.created=new Date();
 const headers=visibleColumns(user),sheet=workbook.addWorksheet('สินค้า',{views:[{state:'frozen',ySplit:1}]});
 sheet.columns=headers.map(([key,header])=>({key,header,width:key==='reagent_name'?38:25}));
 const info=workbook.addWorksheet('วิธีใช้และตัวอย่าง');
 const notes=[['วิธีกรอก Template นำเข้าสินค้า'],['กรอกเฉพาะชีต สินค้า แถว 2 เป็นต้นไป สูงสุด 200 รายการต่อไฟล์'],['ดาวน์โหลด Template ใหม่เพื่อให้รายชื่อเครื่องและ Supplier เป็นปัจจุบัน'],['ชื่อสินค้า เครื่อง Supplier หน่วยหลัก ใช้หน่วยย่อย Lead Time และ Safety Stock ต้องกรอกทุกแถว'],['เลือกเครื่องและ Supplier ที่เปิดใช้งานจากรายการ ห้ามเปลี่ยนหัวคอลัมน์'],['ใช้หน่วยย่อย: 0 = ไม่มี ใช้หน่วยหลักแทน / 1 = มี ต้องกรอกชื่อหน่วยย่อยและจำนวนย่อยต่อหลักเป็นจำนวนเต็มตั้งแต่ 1'],['Lead Time และ Safety Stock เป็นจำนวนเต็มตั้งแต่ 0 · ราคาต้นทุนเป็นบาทต่อหน่วยหลัก ตั้งแต่ 0 (ว่าง = 0)'],['เพิ่มเฉพาะสินค้ารายการใหม่ ไม่แก้รายการเดิมและไม่รับยอด Stock · รายการซ้ำชื่อ+เครื่อง+Supplier จะถูกปฏิเสธ'],['ห้ามใช้สูตร Excel หรือไฟล์ที่มี Macro · แก้ข้อมูลที่ผิดแล้วอัปโหลดใหม่'],['ขั้นตอน: อัปโหลด → ตรวจตัวอย่างและข้อผิดพลาด → ยืนยันบันทึก'],[],['ตัวอย่างเท่านั้น (ไม่ถูกนำเข้า)'],headers.map(([,header])=>header)];
 notes.forEach(row=>info.addRow(row));for(let r=1;r<=10;r++){info.mergeCells(r,1,r,headers.length);info.getRow(r).height=r===1?28:32;}info.columns=headers.map(()=>({width:25}));info.getColumn(1).width=44;
 const machines=(await env.DB.prepare('SELECT name FROM machines WHERE is_active=1 ORDER BY name').all()).results;
 const suppliers=(await env.DB.prepare('SELECT name FROM suppliers WHERE is_active=1 AND is_placeholder=0 ORDER BY name').all()).results;
 info.addRow(['สินค้าตัวอย่าง',machines[0]?.name||'เลือกจากทะเบียน',suppliers[0]?.name||'เลือกจากทะเบียน','กล่อง',1,'ชิ้น',10,7,20,...(user.role==='admin'?[500]:[])]);
 for(const [name,rows] of [['เครื่อง',machines],['Supplier',suppliers]]){const registry=workbook.addWorksheet(name);registry.getColumn(1).width=40;registry.addRow([name+' ที่เปิดใช้งาน']);rows.forEach(row=>registry.addRow([row.name]));if(rows.length)workbook.definedNames.add(`'${name}'!$A$2:$A$${rows.length+1}`,name==='เครื่อง'?'MachineOptions':'SupplierOptions');}
 for(let r=2;r<=201;r++){
  headers.forEach(([key,,required],index)=>{const cell=sheet.getCell(r,index+1);cell.font={name:'Arial',size:11,color:{argb:'FF1F6FEB'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:required?'FFEFF6FF':'FFF8FAFC'}};cell.numFmt=['has_sub_unit','sub_per_main','lead_time_days','reorder_point_sub'].includes(key)?'0':key==='main_unit_price'?'0.00':'@';});
  if(machines.length)sheet.getCell(r,2).dataValidation={type:'list',allowBlank:false,formulae:['MachineOptions'],showErrorMessage:true,errorStyle:'stop',error:'เลือกจากทะเบียนเครื่อง'};
  if(suppliers.length)sheet.getCell(r,3).dataValidation={type:'list',allowBlank:false,formulae:['SupplierOptions'],showErrorMessage:true,errorStyle:'stop',error:'เลือกจากทะเบียน Supplier'};
  sheet.getCell(r,5).dataValidation={type:'list',allowBlank:false,formulae:['"0,1"'],showErrorMessage:true,error:'ระบุ 0 หรือ 1'};
 }
 for(const ws of workbook.worksheets){ws.eachRow(row=>row.eachCell(cell=>{cell.font={name:'Arial',size:11,...cell.font};cell.alignment={vertical:'top',wrapText:true};}));ws.getRow(1).eachCell(cell=>{cell.font={name:'Arial',size:11,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1F6FEB'}};});}
 sheet.autoFilter={from:'A1',to:sheet.getCell(1,headers.length).address};sheet.getRow(1).height=34;
 const buffer=await workbook.xlsx.writeBuffer();return new Response(buffer,{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':'attachment; filename="product-import-template.xlsx"','cache-control':'no-store'}});
}
function checkArchive(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let eocd=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}
 if(eocd<0)throw fail('ไฟล์ไม่ใช่ XLSX ที่ถูกต้อง');
 const count=view.getUint16(eocd+10,true);let pos=view.getUint32(eocd+16,true),expanded=0;
 if(count>1000||!count)throw fail('โครงสร้างไฟล์ใหญ่เกินไป กรุณาใช้ Template');
 for(let i=0;i<count;i++){
  if(pos+46>bytes.length||view.getUint32(pos,true)!==0x02014b50)throw fail('ไฟล์ XLSX เสียหาย');
  const name=new TextDecoder().decode(bytes.subarray(pos+46,pos+46+view.getUint16(pos+28,true)));if(/vbaProject\.bin|externalLinks\//i.test(name))throw fail('ไม่รับไฟล์ที่มี Macro หรือลิงก์ภายนอก');
  expanded+=view.getUint32(pos+24,true);if(expanded>10*1024*1024)throw fail('ข้อมูลในไฟล์ใหญ่เกินไป');
  pos+=46+view.getUint16(pos+28,true)+view.getUint16(pos+30,true)+view.getUint16(pos+32,true);
 }
}
export async function readItemWorkbook(bytes,user){
 if(!bytes.length||bytes.length>2*1024*1024)throw fail('ไฟล์ XLSX ต้องมีขนาดไม่เกิน 2 MB');checkArchive(bytes);
 let files;try{files=unzipSync(bytes);}catch{throw fail('อ่านไฟล์ XLSX ไม่สำเร็จ กรุณาใช้ Template ของระบบ');}
 const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false});
 const xml=path=>{if(!files[path])throw fail('โครงสร้างไฟล์ XLSX ไม่ถูกต้อง');const source=strFromU8(files[path]);if(/<!DOCTYPE|<!ENTITY/i.test(source))throw fail('ไม่รับ XML ที่ประกาศ Entity');return parser.parse(source);};
 const array=value=>value===undefined?[]:Array.isArray(value)?value:[value];
 const sheets=array(xml('xl/workbook.xml').workbook?.sheets?.sheet),sheet=sheets.find(row=>row['@_name']==='สินค้า');
 if(!sheet)throw fail('ไม่พบชีต สินค้า กรุณาใช้ Template ของระบบ');
 const relation=array(xml('xl/_rels/workbook.xml.rels').Relationships?.Relationship).find(row=>row['@_Id']===sheet['@_r:id']);
 const target=String(relation?.['@_Target']||'');if(!target||target.includes('..')||relation?.['@_TargetMode']==='External')throw fail('โครงสร้างชีตไม่ถูกต้อง');
 const sheetPath=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^xl\//,'');
 const stringValue=value=>typeof value==='string'?value:String(value?.['#text']??'');
 const richText=value=>value?.t!==undefined?stringValue(value.t):array(value?.r).map(part=>stringValue(part.t)).join('');
 const strings=files['xl/sharedStrings.xml']?array(xml('xl/sharedStrings.xml').sst?.si).map(richText):[];
 const inputRows=array(xml(sheetPath).worksheet?.sheetData?.row),headers=visibleColumns(user),rows=[];
 if(inputRows.length>1000)throw fail('ไฟล์มีแถวเกิน Template');
 const decoded=new Map();
 for(const entry of inputRows){
  const index=Number(entry['@_r']);if(!Number.isSafeInteger(index)||index<1||index>1000||decoded.has(index))throw fail('หมายเลขแถวไม่ถูกต้อง');
  const values=new Map();
  for(const cell of array(entry.c)){
   const ref=String(cell['@_r']||''),match=/^([A-Z]+)([0-9]+)$/.exec(ref);if(!match||Number(match[2])!==index)throw fail('ตำแหน่งเซลล์ไม่ถูกต้อง');
   const col=[...match[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);if(col>headers.length)throw fail('คอลัมน์เกิน Template');
   if(cell.f!==undefined||['e','d'].includes(cell['@_t'])){values.set(col,{invalid:true});continue;}
   let value=cell['@_t']==='s'?strings[Number(cell.v)]:cell['@_t']==='inlineStr'?richText(cell.is):cell.v??'';
   if(typeof value==='object')value={invalid:true};values.set(col,value??'');
  }
  decoded.set(index,values);
 }
 headers.forEach(([,header],index)=>{if(decoded.get(1)?.get(index+1)!==header)throw fail('หัวคอลัมน์ไม่ตรง Template กรุณาดาวน์โหลด Template ใหม่');});
 for(const [row,values] of [...decoded].sort((a,b)=>a[0]-b[0])){
  if(row===1||[...values.values()].every(value=>typeof value!=='object'&&text(value)===''))continue;
  const result={excel_row:row},errors=[];
  headers.forEach(([key,header],index)=>{const value=values.get(index+1);if(value!==null&&typeof value==='object'){errors.push(header+': ต้องกรอกค่าธรรมดา ห้ามใช้สูตรหรือลิงก์');result[key]='';}else result[key]=value??'';});
  rows.push({...result,parse_errors:errors});if(rows.length>200)throw fail('นำเข้าได้สูงสุด 200 รายการต่อไฟล์');
 }
 if(!rows.length)throw fail('ยังไม่มีข้อมูลในชีต สินค้า');return rows;
}
export async function validateImportRows(env,user,rows){
 const [machines,suppliers,existing]=await env.DB.batch([env.DB.prepare('SELECT name FROM machines WHERE is_active=1'),env.DB.prepare('SELECT supplier_id,name FROM suppliers WHERE is_active=1 AND is_placeholder=0'),env.DB.prepare('SELECT reagent_name,machine,supplier FROM items WHERE is_deleted=0')]);
 const known=new Set(existing.results.map(identity)),seen=new Set();
 return rows.map(source=>{
  const errors=[...(source.parse_errors||[])],row={};
  for(const [key,,required] of visibleColumns(user)){row[key]=text(source[key]);if(required&&!row[key])errors.push(columns.find(col=>col[0]===key)[1]+': จำเป็นต้องกรอก');if(row[key].length>200)errors.push('ข้อความใน '+key+' ยาวเกิน 200 ตัวอักษร');}
  const machine=machines.results.find(m=>normalized(m.name)===normalized(row.machine)),supplier=suppliers.results.find(s=>normalized(s.name)===normalized(row.supplier));
  if(!machine)errors.push('เครื่องไม่อยู่ในทะเบียนที่เปิดใช้งาน');else row.machine=machine.name;
  if(!supplier)errors.push('Supplier ไม่อยู่ในทะเบียนที่เปิดใช้งาน');else {row.supplier=supplier.name;row.supplier_id=supplier.supplier_id;}
  if(!['0','1'].includes(row.has_sub_unit))errors.push('ใช้หน่วยย่อยต้องเป็น 0 หรือ 1');row.has_sub_unit=Number(row.has_sub_unit);
  const integer=(key,minimum)=>{const value=Number(row[key]);if(text(row[key])===''||!Number.isSafeInteger(value)||value<minimum||value>1000000)errors.push(key+': ต้องเป็นจำนวนเต็ม '+minimum+' ถึง 1000000');return value;};
  if(row.has_sub_unit===1){if(!row.sub_unit)errors.push('ต้องระบุหน่วยย่อย');row.sub_per_main=integer('sub_per_main',1);}else {row.sub_unit=row.main_unit;row.sub_per_main=1;}
  row.lead_time_days=integer('lead_time_days',0);row.reorder_point_sub=integer('reorder_point_sub',0);
  row.main_unit_price=user.role==='admin'?Number(row.main_unit_price||0):0;
  if(!Number.isFinite(row.main_unit_price)||row.main_unit_price<0||row.main_unit_price>1e9)errors.push('ราคาต้นทุนต้องเป็นตัวเลข 0 ถึง 1000000000');
  row.main_unit_price=Math.round(row.main_unit_price*100)/100;row.unit_price=Math.round(row.main_unit_price/row.sub_per_main*100)/100;
  const key=identity(row);if(known.has(key))errors.push('รายการซ้ำ: มีสินค้า ชื่อ+เครื่อง+Supplier นี้ในระบบแล้ว');if(seen.has(key))errors.push('รายการซ้ำในไฟล์');seen.add(key);
  return {excel_row:source.excel_row,data:row,errors};
 });
}
export async function previewItemImport(request,env,user){
 if(Number(request.headers.get('content-length')||0)>2*1024*1024)throw fail('ไฟล์ใหญ่เกิน 2 MB');
 const reader=request.body?.getReader();if(!reader)throw fail('กรุณาเลือกไฟล์ XLSX');let total=0;const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>2*1024*1024){await reader.cancel();throw fail('ไฟล์ใหญ่เกิน 2 MB');}chunks.push(value);}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const source=await readItemWorkbook(bytes,user),rows=await validateImportRows(env,user,source),valid=rows.every(row=>!row.errors.length);let importId=null;
 if(valid){await env.DB.prepare('DELETE FROM item_imports WHERE user_id=? AND expires_at<? AND result_json IS NULL').bind(user.user_id,new Date().toISOString()).run();importId=crypto.randomUUID();await env.DB.prepare('INSERT INTO item_imports(import_id,user_id,rows_json,created_at,expires_at) VALUES(?,?,?,?,?)').bind(importId,user.user_id,JSON.stringify({source,ids:rows.map(()=> 'ITM-'+crypto.randomUUID())}),new Date().toISOString(),new Date(Date.now()+30*60000).toISOString()).run();}
 return {ok:true,import_id:importId,valid,rows};
}
export async function commitItemImport(request,env,user){
 const body=await request.json();const batch=await env.DB.prepare('SELECT * FROM item_imports WHERE import_id=? AND user_id=?').bind(String(body.import_id||''),user.user_id).first();
 if(!batch)throw fail('ไม่พบข้อมูลตรวจสอบ กรุณาอัปโหลดใหม่',404);
 if(batch.result_json)return JSON.parse(batch.result_json);
 if(batch.expires_at<new Date().toISOString())throw fail('ข้อมูลตรวจสอบหมดอายุ กรุณาอัปโหลดใหม่',409);
 const {source,ids}=JSON.parse(batch.rows_json),rows=await validateImportRows(env,user,source);
 if(rows.some(row=>row.errors.length)){const saved=await env.DB.prepare('SELECT result_json FROM item_imports WHERE import_id=? AND user_id=?').bind(batch.import_id,user.user_id).first();if(saved?.result_json)return JSON.parse(saved.result_json);throw fail('ข้อมูลเปลี่ยนหลังตรวจสอบ หรือมีรายการซ้ำ กรุณาอัปโหลดไฟล์เพื่อตรวจสอบใหม่',409);}
 const stamp=new Date().toISOString(),result={ok:true,import_id:batch.import_id,count:rows.length,item_ids:ids},statements=[];
 rows.forEach(({data:r},index)=>{
 statements.push(env.DB.prepare(`INSERT INTO workflow_guards(operation_id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM machines WHERE name=? COLLATE NOCASE AND is_active=1) AND EXISTS(SELECT 1 FROM suppliers WHERE supplier_id=? AND is_active=1 AND is_placeholder=0) AND NOT EXISTS(SELECT 1 FROM items WHERE is_deleted=0 AND lower(trim(reagent_name))=lower(?) AND lower(trim(machine))=lower(?) AND lower(trim(supplier))=lower(?)) THEN 1 ELSE 0 END`).bind(batch.import_id,r.machine,r.supplier_id,r.reagent_name,r.machine,r.supplier));
 statements.push(env.DB.prepare(`INSERT INTO items(item_id,reagent_name,machine,main_unit,sub_unit,sub_per_main,supplier,unit_price,main_unit_price,lead_time_days,reorder_point_sub,created_at,updated_at,created_by,updated_by,has_sub_unit,supplier_id,is_active,is_deleted) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0)`).bind(ids[index],r.reagent_name,r.machine,r.main_unit,r.sub_unit,r.sub_per_main,r.supplier,r.unit_price,r.main_unit_price,r.lead_time_days,r.reorder_point_sub,stamp,stamp,user.username,user.username,r.has_sub_unit,r.supplier_id));});
 statements.push(env.DB.prepare('DELETE FROM workflow_guards WHERE operation_id=?').bind(batch.import_id));
 statements.push(env.DB.prepare("UPDATE item_imports SET rows_json='{}',result_json=? WHERE import_id=? AND user_id=?").bind(JSON.stringify(result),batch.import_id,user.user_id));
 statements.push(env.DB.prepare('INSERT INTO audit_logs(audit_id,timestamp,username,action,target_type,target_id,result,details) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),stamp,user.username,'IMPORT_ITEMS','item_import',batch.import_id,'SUCCESS',JSON.stringify({count:rows.length,item_ids:ids})));
 try{await env.DB.batch(statements);}catch(error){const saved=await env.DB.prepare('SELECT result_json FROM item_imports WHERE import_id=? AND user_id=?').bind(batch.import_id,user.user_id).first();if(saved?.result_json)return JSON.parse(saved.result_json);throw fail('ข้อมูลเปลี่ยนระหว่างนำเข้า กรุณาอัปโหลดเพื่อตรวจสอบใหม่',409);}
 return result;
}
