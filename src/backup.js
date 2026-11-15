export const BACKUP_TABLES=['machines','suppliers','items','stock_units','package_barcodes','movements','purchase_requisitions','purchase_requisition_items','settings','users','audit_logs','stock_operations','stock_operation_units','stock_counts','pr_delivery_terms','analytics_purchase_totals','pr_split_requests'];
const fail=message=>Object.assign(new Error(message),{status:400});
export async function snapshot(env){
 // A single read batch gives all tables the same transactional snapshot.
 const results=await env.DB.batch(BACKUP_TABLES.map(table=>env.DB.prepare(`SELECT * FROM ${table}`)));
 const tables=Object.fromEntries(BACKUP_TABLES.map((table,i)=>[table,results[i].results||[]]));
 return {format:'medical-trend-stock-backup',version:2,exported_at:new Date().toISOString(),counts:Object.fromEntries(BACKUP_TABLES.map(t=>[t,tables[t].length])),tables};
}
export function validateBackup(data){
 if(!data||!data.tables||typeof data.tables!=='object'||Array.isArray(data.tables))throw fail('ไฟล์ Backup ไม่ถูกต้อง');
 if(data.version!==undefined&&(data.format!=='medical-trend-stock-backup'||data.version!==2))throw fail('ไม่รองรับรูปแบบหรือเวอร์ชัน Backup นี้');
 const required=data.version===2?BACKUP_TABLES:['items','stock_units','package_barcodes','movements','purchase_requisitions','purchase_requisition_items','settings','users','audit_logs'];
 for(const table of required)if(!Array.isArray(data.tables[table]))throw fail(`ไฟล์ Backup ไม่ครบ: ไม่มีตาราง ${table}`);
 for(const [table,rows] of Object.entries(data.tables)){
  if(!BACKUP_TABLES.includes(table))throw fail(`ไม่รองรับตาราง ${table}`);
  if(!Array.isArray(rows)||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)||Object.values(row).some(value=>value!==null&&!['string','number'].includes(typeof value))))throw fail(`ข้อมูลตาราง ${table} ไม่ถูกต้อง`);
  if(data.version===2&&data.counts?.[table]!==rows.length)throw fail(`จำนวนแถวตาราง ${table} ไม่ตรงกับไฟล์ Backup`);
 }
 if(!data.tables.users.some(row=>row.role==='admin'&&Number(row.is_active)===1))throw fail('ไฟล์ Backup ต้องมีบัญชี admin ที่เปิดใช้งาน');
 return data.tables;
}
export async function restoreInserts(env,tables){
 const statements=[];
 for(const table of BACKUP_TABLES){
  const rows=tables[table]||[];if(!rows.length)continue;
  const info=await env.DB.prepare(`PRAGMA table_info(${table})`).all(),allowed=new Set(info.results.map(c=>c.name));
  // Group by supplied columns so legacy rows still receive database defaults.
  const groups=new Map();for(const row of rows){const keys=Object.keys(row).sort();if(!keys.length||keys.some(k=>!allowed.has(k)))throw fail(`คอลัมน์ตาราง ${table} ไม่ถูกต้อง`);const key=JSON.stringify(keys);if(!groups.has(key))groups.set(key,{keys,rows:[]});groups.get(key).rows.push(row);}
  for(const {keys,rows:group} of groups.values()){
   let chunk=[],bytes=2;
   const flush=()=>{if(!chunk.length)return;const columns=keys.map(k=>`"${k}"`).join(','),values=keys.map(k=>`json_extract(value,'$.${k}')`).join(',');statements.push(env.DB.prepare(`INSERT INTO ${table} (${columns}) SELECT ${values} FROM json_each(?)`).bind('['+chunk.join(',')+']'));chunk=[];bytes=2;};
   for(const row of group){const value=JSON.stringify(row),length=new TextEncoder().encode(value).length;if(length>1500000)throw fail(`แถวข้อมูลใน ${table} ใหญ่เกินไป`);if(bytes+length+1>1500000)flush();chunk.push(value);bytes+=length+1;}flush();
  }
 }
 return statements;
}
