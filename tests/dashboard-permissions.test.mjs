import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dashboardPermissions,dashboardProjection} from '../src/dashboard-permissions.js';
test('admin always retains access and staff has safe backwards-compatible defaults',()=>{
 assert.deepEqual(dashboardPermissions('staff'),{stock:true,near:true,delivery:true,finance:false});
 assert.ok(Object.values(dashboardPermissions('admin',{stock:false,finance:false})).every(Boolean));
 assert.equal(dashboardPermissions('staff',{finance:'yes'}).finance,false);
});
test('dashboard projection removes restricted datasets, not just cards',()=>{
 const payload={rows:[{name:'item'}],machines:['A'],total_value:100,analytics:{range:{days:1},near:[{lot:'secret'}],deliveries:[{vendor:'secret'}],inventory:[{used_value:100}],purchase_total:1000}};
 const hidden=dashboardProjection(payload,{stock:false,near:false,delivery:false,finance:false});
 assert.deepEqual(hidden.rows,[]);assert.deepEqual(hidden.machines,[]);assert.equal(hidden.total_value,null);assert.equal(hidden.can_view_prices,false);assert.deepEqual(hidden.analytics.near,[]);assert.deepEqual(hidden.analytics.deliveries,[]);assert.equal(hidden.analytics.inventory,null);assert.equal(hidden.analytics.purchase_total,null);
 const finance=dashboardProjection(payload,{stock:false,near:false,delivery:false,finance:true});
 assert.deepEqual(finance.rows,[]);assert.equal(finance.analytics.inventory[0].used_value,100);
});
