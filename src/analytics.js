const DAY=86400000;
export function period(params,today=new Date().toISOString().slice(0,10)){
 const mode=params.get('period')||'month';let end=today,start=today;
 if(mode==='week')start=new Date(Date.parse(today+'T00:00:00Z')-6*DAY).toISOString().slice(0,10);
 else if(mode==='month')start=today.slice(0,8)+'01';
 else if(mode==='custom'){start=params.get('start');end=params.get('end');}
 else if(mode!=='day')throw Object.assign(new Error('ช่วงเวลาไม่ถูกต้อง'),{status:400});
 const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&!isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
 const days=(Date.parse(end)-Date.parse(start))/DAY+1;
 if(!valid(start)||!valid(end)||days<1||days>366||end>today)throw Object.assign(new Error('เลือกช่วงวันย้อนหลังไม่เกิน 366 วัน และไม่เกินวันนี้'),{status:400});
 return {start,end,days};
}
export function inventoryMetrics(items,events,range){
 return items.map(i=>{
  let closing=Number(i.qty_sub),opening=closing,used=0,received=0,wasted=0;const reasons={};
  for(const e of events.filter(e=>e.item_id===i.item_id)){
   const q=Number(e.qty),date=e.day;
   const delta=e.type==='RECEIVE'||e.type==='REVERSAL_CONSUME'||e.type==='REVERSAL_DISPOSE'?q:['CONSUME','CONSUME_PACKAGE'].includes(e.type)||e.type==='DISPOSE'||e.type==='REVERSAL_RECEIVE'?-q:e.type==='ADJUSTMENT'?q:e.type==='REVERSAL_ADJUSTMENT'?-Number(e.adjustment||0):0;
   if(date>range.end)closing-=delta;
   if(date>=range.start)opening-=delta;
   if(date<range.start||date>range.end)continue;
   if(['CONSUME','CONSUME_PACKAGE'].includes(e.type))used+=q;if(e.type==='REVERSAL_CONSUME')used-=q;
   if(e.type==='RECEIVE')received+=q;if(e.type==='REVERSAL_RECEIVE')received-=q;
   if(e.type==='DISPOSE'||e.type==='REVERSAL_DISPOSE'){
    const value=(e.type==='DISPOSE'?q:-q)*Number(i.unit_price);wasted+=value;
    const reason=e.reason||'ไม่ระบุ';const key=/หมดอายุ|expir/i.test(reason)?'หมดอายุ':/เสื่อม|เสีย|damage/i.test(reason)?'เสื่อมสภาพ / เสียหาย':'อื่น ๆ';
    reasons[key]=(reasons[key]||0)+value;
   }
  }
  const price=Number(i.unit_price),average=(opening+closing)/2*price;
  return {item_id:i.item_id,name:i.name,machine:i.machine||'ไม่ระบุเครื่อง',opening_value:opening*price,closing_value:closing*price,average_value:average,used_value:used*price,received_value:received*price,wasted_value:wasted,reasons,turnover:average>0?used*price/average:null};
 });
}
export async function analytics(env,params,items,prices){
 const range=period(params),ids=new Set(items.map(i=>i.item_id));
 // Aggregate in SQL: never send individual QR records or rescan on a QR write.
 const batches=await env.DB.batch([
  env.DB.prepare(`SELECT m.item_id,substr(m.timestamp,1,10) day,m.type,SUM(m.quantity_sub) qty,COALESCE(original.operator_note,m.operator_note) reason,SUM(c.counted_qty-c.system_qty) adjustment FROM movements m LEFT JOIN stock_operations o ON o.operation_id=m.movement_id LEFT JOIN stock_counts c ON c.operation_id=o.reverses_id LEFT JOIN movements original ON original.movement_id=o.reverses_id WHERE m.timestamp>=? GROUP BY m.item_id,day,m.type,COALESCE(original.operator_note,m.operator_note)`).bind(range.start),
  env.DB.prepare(`SELECT s.item_id,s.lot,s.expiry_date,COUNT(*) quantity FROM stock_units s WHERE s.status='IN_STOCK' AND s.expiry_date<date('now','+90 days') GROUP BY s.item_id,s.lot,s.expiry_date ORDER BY s.expiry_date`),
  env.DB.prepare(`SELECT p.pr_id,p.pr_no,p.status,l.line_id,l.item_id,l.item_name,l.supplier,l.order_qty,l.received_qty,t.issued_date,t.expected_date,MAX(CASE WHEN o.reversed_by='' THEN substr(o.created_at,1,10) END) received_date FROM purchase_requisitions p JOIN purchase_requisition_items l ON l.pr_id=p.pr_id LEFT JOIN pr_delivery_terms t ON t.pr_id=p.pr_id LEFT JOIN stock_operations o ON o.pr_line_id=l.line_id AND o.kind='RECEIVE' WHERE p.status='APPROVED' GROUP BY l.line_id ORDER BY p.created_at DESC`)
 ]);
 const budget=prices?await env.DB.prepare('SELECT total_value FROM analytics_purchase_totals WHERE start_date=? AND end_date=?').bind(range.start,range.end).first():null;
 const today=new Date().toISOString().slice(0,10),near=batches[1].results.filter(r=>ids.has(r.item_id)).map(r=>{const i=items.find(i=>i.item_id===r.item_id),days=Math.round((Date.parse(r.expiry_date)-Date.parse(today))/DAY);return {...r,name:i.name,machine:i.machine,unit:i.sub_unit,days,bucket:days<0?'หมดอายุ':days<30?'<30 วัน':days<60?'30–59 วัน':'60–89 วัน'};});
 const groups=new Map();for(const row of batches[2].results){if(!groups.has(row.pr_id))groups.set(row.pr_id,[]);groups.get(row.pr_id).push(row);}
 const deliveries=[];for(const lines of groups.values()){
  if((params.get('machine')||params.get('q'))&&!lines.some(l=>ids.has(l.item_id)))continue;
  // Evaluate each vendor's complete portion of an order, including all its lines.
  for(const vendor of new Set(lines.map(l=>l.supplier||'ไม่ระบุ Vendor'))){const portion=lines.filter(l=>(l.supplier||'ไม่ระบุ Vendor')===vendor),first=portion[0],complete=portion.every(l=>Number(l.received_qty)>=Number(l.order_qty)&&Number(l.order_qty)>0&&l.received_date),received=complete?portion.map(l=>l.received_date).sort().at(-1):null;
   deliveries.push({pr_id:first.pr_id,pr_no:first.pr_no,vendor,issued_date:first.issued_date,expected_date:first.expected_date,received_date:received,complete:!!complete,lead_days:received&&first.issued_date?Math.round((Date.parse(received)-Date.parse(first.issued_date))/DAY):null,eligible:!!(first.issued_date&&first.expected_date&&first.issued_date>=range.start&&first.issued_date<=range.end&&first.expected_date<=range.end),on_time:!!(complete&&received<=first.expected_date)});
  }
 }
 return {range,near,deliveries,purchase_total:budget?.total_value??null,inventory:prices?inventoryMetrics(items,batches[0].results.filter(e=>ids.has(e.item_id)),range):null};
}
