import QRCode from 'qrcode';
const escape=value=>String(value??'').replace(/[<>&'\"]/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[char]));
export async function makeLabelHtml(labels,{autoPrint=true}={}){
 const cards=[];
 for(const label of labels){
  const item=label.item||{},code=String(label.code||'');
  const svg=await QRCode.toString(code,{type:'svg',margin:2,width:130,errorCorrectionLevel:'M'});
  cards.push(`<section class="label"><div class="qr">${svg}<div class="code fit-text">${escape(code)}</div></div><div class="text fit-text">${label.type==='main'?'<div class="warn">หน่วยหลัก · ระวังการแปะผิด</div>':''}<div class="name">${escape(item.reagent_name||label.reagent_name)}</div><div>Lot: ${escape(label.lot)}</div><div>Exp: ${escape(label.expiry||label.expiry_date)}</div><div>เครื่อง: ${escape(item.machine||label.machine)}</div>${label.type==='main'?`<div>จำนวนย่อย: ${escape(label.sub_count||0)} ${escape(item.sub_unit||label.sub_unit)}</div>`:''}</div></section>`);
 }
 return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>QR Labels · 50 × 25 mm</title><style>
 @page { size:50mm 25mm; margin:0; }
 * { box-sizing:border-box; }
 html,body { margin:0; padding:0; color:#000; font-family:Arial,"Tahoma",sans-serif; }
 .label { width:50mm; height:25mm; padding:2mm; display:grid; grid-template-columns:18mm minmax(0,1fr); gap:1mm; align-items:center; break-inside:avoid; break-after:page; page-break-after:always; }
 .label:last-child { break-after:auto; page-break-after:auto; }
 .qr { width:18mm; height:21mm; display:flex; flex-direction:column; align-items:center; justify-content:center; }
 .qr svg { width:17mm; height:17mm; display:block; flex:0 0 17mm; }
 .code { width:18mm; height:4mm; font:700 5.2pt/1.1 Arial,sans-serif; text-align:center; overflow-wrap:anywhere; word-break:break-all; }
 .text { height:21mm; min-width:0; font-size:7.2pt; line-height:1.2; font-weight:600; display:flex; flex-direction:column; justify-content:center; overflow-wrap:anywhere; }
 .text > div { flex-shrink:0; }
 .name { font-size:1.12em; line-height:1.15; font-weight:800; margin-bottom:.4mm; }
 .warn { font-size:.85em; font-weight:800; margin-bottom:.4mm; }
 @media screen { body { background:#e5e7eb; padding:8px; } .label { background:white; margin-bottom:8px; outline:1px solid #9ca3af; } }
 @media print { html,body { width:50mm; } }
 </style></head><body>${cards.join('')}<script>
 function fitLabels(){document.querySelectorAll('.fit-text').forEach(el=>{let size=parseFloat(getComputedStyle(el).fontSize);while((el.scrollHeight>el.clientHeight||el.scrollWidth>el.clientWidth)&&size>4){size-=.2;el.style.fontSize=size+'px';}});}
 window.addEventListener('beforeprint',fitLabels);
 (document.fonts?document.fonts.ready:Promise.resolve()).then(()=>requestAnimationFrame(()=>{fitLabels();${autoPrint?'window.print();':''}}));
 </script></body></html>`;
}
