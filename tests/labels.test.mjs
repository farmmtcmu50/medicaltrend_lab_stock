import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeLabelHtml} from '../src/labels.js';
test('stickers preserve full text and QR payload with print-safe sizing and font fitting',async()=>{
 const code='MT261104123456ABCDEFGHIJKLMN';
 const html=await makeLabelHtml([{code,type:'main',item:{reagent_name:'สินค้าชื่อยาวมาก <Sensitive> & name',machine:'Analyzer extended machine name',sub_unit:'Test'},lot:'LOT-12345678901234567890',expiry:'2030-12-31',sub_count:100}],{autoPrint:false});
 assert.ok(html.includes(code));assert.ok(html.includes('สินค้าชื่อยาวมาก &lt;Sensitive&gt; &amp; name'));
 assert.match(html,/size:50mm 25mm/);assert.match(html,/padding:2mm/);assert.match(html,/document.fonts.ready/);assert.match(html,/beforeprint/);assert.doesNotMatch(html,/text-overflow:ellipsis|overflow:hidden|window.print\(\)/);
 assert.match(await makeLabelHtml([{code,type:'sub'}]),/window.print\(\)/);
});
test('all supported sticker sizes have matching print page and usable content area',async()=>{
 for(const height of [20,25,30]){
  const html=await makeLabelHtml([{code:'MT-123',type:'main',item:{reagent_name:'สินค้า'},sub_count:10}],{size:`50x${height}`,autoPrint:false});
  assert.ok(html.includes(`size:50mm ${height}mm`));
  assert.ok(html.includes(`height:${height-4}mm`));
  assert.doesNotMatch(html,/window.print\(\)/);
 }
 await assert.rejects(makeLabelHtml([],{size:'100x100'}),/ขนาด/);
});
