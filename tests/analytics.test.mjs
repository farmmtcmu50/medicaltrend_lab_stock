import {test} from 'node:test';
import assert from 'node:assert/strict';
import {period,inventoryMetrics} from '../src/analytics.js';
test('date ranges are inclusive and reject future, invalid and overly broad requests',()=>{
 assert.deepEqual(period(new URLSearchParams('period=week'),'2026-10-22'),{start:'2026-10-16',end:'2026-10-22',days:7});
 assert.equal(period(new URLSearchParams('period=month'),'2026-10-22').days,22);
 for(const query of ['period=custom&start=2026-02-30&end=2026-03-02','period=custom&start=2026-10-23&end=2026-10-24','period=custom&start=2020-01-01&end=2026-10-22','period=other'])assert.throws(()=>period(new URLSearchParams(query),'2026-10-22'));
});
test('valuation reconstructs boundaries and nets reversals at the effective date',()=>{
 const metrics=inventoryMetrics([{item_id:'a',name:'A',machine:'M',qty_sub:17,unit_price:10}],[
 {item_id:'a',day:'2026-10-01',type:'RECEIVE',qty:10},
 {item_id:'a',day:'2026-10-02',type:'CONSUME',qty:4},
 {item_id:'a',day:'2026-10-03',type:'REVERSAL_CONSUME',qty:1},
 {item_id:'a',day:'2026-10-03',type:'DISPOSE',qty:2,reason:'หมดอายุ'},
 {item_id:'a',day:'2026-10-04',type:'REVERSAL_DISPOSE',qty:1,reason:'หมดอายุ'},
 {item_id:'a',day:'2026-10-05',type:'ADJUSTMENT',qty:-2},
 {item_id:'a',day:'2026-10-06',type:'REVERSAL_ADJUSTMENT',qty:2,adjustment:-2},
 {item_id:'a',day:'2026-10-20',type:'RECEIVE',qty:1}
 ],{start:'2026-10-01',end:'2026-10-10',days:10})[0];
 assert.equal(metrics.opening_value,100);assert.equal(metrics.closing_value,160);assert.equal(metrics.average_value,130);assert.equal(metrics.used_value,30);assert.equal(metrics.received_value,100);assert.equal(metrics.wasted_value,10);assert.equal(metrics.reasons['หมดอายุ'],10);assert.equal(metrics.turnover,30/130);
});
test('zero inventory denominator is unavailable, not Infinity',()=>{
 assert.equal(inventoryMetrics([{item_id:'a',qty_sub:0,unit_price:5}],[],{start:'2026-10-01',end:'2026-10-01'})[0].turnover,null);
});

test('OTIF counts only due dated orders and requires every vendor line to be received',async()=>{
 const {analytics}=await import('../src/analytics.js');
 const lines=[
 {pr_id:'partial',pr_no:'1',supplier:'A',item_id:'a',order_qty:2,received_qty:2,issued_date:'2026-10-01',expected_date:'2026-10-05',received_date:'2026-10-03'},
 {pr_id:'partial',pr_no:'1',supplier:'A',item_id:'a',order_qty:2,received_qty:1,issued_date:'2026-10-01',expected_date:'2026-10-05',received_date:'2026-10-03'},
 {pr_id:'late',pr_no:'2',supplier:'B',item_id:'a',order_qty:1,received_qty:1,issued_date:'2026-10-01',expected_date:'2026-10-05',received_date:'2026-10-06'},
 {pr_id:'timely',pr_no:'3',supplier:'B',item_id:'a',order_qty:1,received_qty:1,issued_date:'2026-10-01',expected_date:'2026-10-05',received_date:'2026-10-05'},
 {pr_id:'future',pr_no:'4',supplier:'A',item_id:'a',order_qty:1,received_qty:0,issued_date:'2026-10-01',expected_date:'2099-10-05'},
 {pr_id:'missing',pr_no:'5',supplier:'A',item_id:'a',order_qty:1,received_qty:1,received_date:'2026-10-05'}
 ];
 const db={prepare(){return {bind(){return this;},async first(){return null;}};},async batch(){return [{results:[]},{results:[]},{results:lines}];}};
 const result=await analytics({DB:db},new URLSearchParams('period=custom&start=2026-10-01&end=2026-10-20'),[{item_id:'a',qty_sub:0,unit_price:1}],true);
 const due=result.deliveries.filter(r=>r.eligible);assert.equal(due.length,3);assert.equal(due.filter(r=>r.on_time).length,1);
 assert.equal(due.find(r=>r.pr_id==='partial').complete,false);assert.equal(due.find(r=>r.pr_id==='late').lead_days,5);
});


test('period activity includes net-zero and zero-price movements but excludes outside-period events',()=>{
 const items=['net-zero','free','idle','outside','adjust'].map(item_id=>({item_id,qty_sub:5,unit_price:item_id==='free'?0:10}));
 const rows=inventoryMetrics(items,[{item_id:'net-zero',day:'2026-10-02',type:'RECEIVE',qty:2},{item_id:'net-zero',day:'2026-10-03',type:'CONSUME',qty:2},{item_id:'free',day:'2026-10-03',type:'RECEIVE',qty:1},{item_id:'outside',day:'2026-10-11',type:'RECEIVE',qty:1},{item_id:'adjust',day:'2026-10-04',type:'ADJUSTMENT',qty:0,movement_count:2}],{start:'2026-10-01',end:'2026-10-10'});
 assert.deepEqual(rows.filter(r=>r.has_movement).map(r=>r.item_id),['net-zero','free','adjust']);
 assert.equal(rows[0].opening_value,rows[0].closing_value);
});


test('this year starts January 1 and ends today including leap years',()=>{
 assert.deepEqual(period(new URLSearchParams('period=year'),'2026-10-23'),{start:'2026-01-01',end:'2026-10-23',days:296});
 assert.deepEqual(period(new URLSearchParams('period=year'),'2026-01-01'),{start:'2026-01-01',end:'2026-01-01',days:1});
 assert.equal(period(new URLSearchParams('period=year'),'2024-12-31').days,366);
});
