import {test} from 'node:test';
import assert from 'node:assert/strict';
import {executiveMetrics} from '../src/executive.js';
import {inventoryMetrics} from '../src/analytics.js';
const item=(id,qty,price)=>({item_id:id,name:id,machine:'M',supplier:'V',qty_sub:qty,unit_price:price,main_unit:'BOX',sub_unit:'TEST',sub_per_main:5,lead_time_days:7,reorder_point_sub:6});
test('executive metrics distinguish current stock, period flows, FEFO and procurement',()=>{
 const items=[item('A',5,10),item('B',0,0),item('C',20,5)];
 const range={start:'2026-11-01',end:'2026-11-10',days:10};
 const inventory=[{item_id:'A',name:'A',machine:'M',opening_value:150,closing_value:50,average_value:100,used_value:100,used_qty:10,received_value:0,wasted_value:0,has_movement:true,reasons:{}},{item_id:'B',name:'B',machine:'M',opening_value:0,closing_value:0,average_value:0,used_value:0,used_qty:2,received_value:0,wasted_value:0,has_movement:true,reasons:{}},{item_id:'C',name:'C',machine:'M',opening_value:100,closing_value:100,average_value:100,used_value:0,used_qty:0,received_value:0,wasted_value:0,has_movement:false,reasons:{}}];
 const current={range,inventory,near:[{item_id:'A',days:-1,quantity:1},{item_id:'A',days:3,quantity:4},{item_id:'C',days:5,quantity:20}],deliveries:[{vendor:'V',eligible:true,on_time:false,complete:true,issued_date:'2026-11-01',expected_date:'2026-11-03',received_date:'2026-11-05',lead_days:4}],purchase_total:1000};
 const lines=[{pr_id:'P1',pr_no:'P1',supplier:'V',status:'APPROVED',request_date:'2026-11-01',created_at:'2026-11-01T00:00:00Z',approved_at:'2026-11-03T00:00:00Z',order_qty:5,received_qty:1,unit_price:10},{pr_id:'P1',pr_no:'P1',supplier:'V',status:'APPROVED',request_date:'2026-11-01',created_at:'2026-11-01T00:00:00Z',approved_at:'2026-11-03T00:00:00Z',order_qty:2,received_qty:2,unit_price:10},{pr_id:'P2',pr_no:'P2',supplier:'V',status:'PENDING',request_date:'2026-10-01',order_qty:1,received_qty:0,unit_price:20}];
 const d=executiveMetrics(items,current,{range:{start:'2026-10-22',end:'2026-10-31',days:10},inventory},lines,'2026-11-10');
 assert.equal(d.metrics.closing_value,150);assert.equal(d.metrics.doh,15);assert.equal(d.stock.current_value,150);assert.equal(d.stock.stockout,1);assert.equal(d.stock.reorder,2);assert.equal(d.stock.no_movement_value,100);
 assert.equal(d.details.find(row=>row.item_id==='A').below_lead,true);assert.equal(d.details.find(row=>row.item_id==='B').used_qty,2);
 assert.equal(d.expired_value,10);assert.equal(d.near_value,140);assert.equal(d.near[1].risk,true);assert.equal(d.near[2].estimated_days,null);
 assert.equal(d.procurement.period_count,1);assert.equal(d.procurement.period_value,70);assert.equal(d.procurement.pending.length,1);assert.equal(d.procurement.outstanding[0].outstanding_value,40);assert.equal(d.procurement.approval_days,2);assert.equal(d.procurement.otif,0);assert.equal(d.procurement.lead_days,4);assert.equal(d.vendors[0].pr_count,1);
});
test('usage quantity remains available when a product has no cost price',()=>{
 const range={start:'2026-11-01',end:'2026-11-10',days:10};
 const metrics=inventoryMetrics([item('ZERO',5,0)],[{item_id:'ZERO',day:'2026-11-05',type:'CONSUME',qty:3,movement_count:1}],range);
 assert.equal(metrics[0].used_qty,3);assert.equal(metrics[0].used_value,0);assert.equal(metrics[0].opening_qty,8);
});
