import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExecutiveReport} from '../public/executive.js';
import {executiveMetrics} from '../src/executive.js';
function fixture(){const range={start:'2026-11-01',end:'2026-11-16',days:16},current={range,inventory:[],near:[],deliveries:[],purchase_total:null};return {ok:true,...executiveMetrics([],current,{...current,range:{start:'2026-10-16',end:'2026-10-31',days:16}},[],'2026-11-16'),filters:{machine:'',supplier:''},options:{machines:[],suppliers:[]}};}
function ui(api){
 const elements=new Map(),fields=Object.fromEntries(['period','start','end','machine','supplier'].map(k=>[k,{value:k==='period'?'month':''}]));
 elements.set('#executiveForm',{elements:{namedItem:key=>fields[key]}});
 const $=key=>{if(!elements.has(key))elements.set(key,{innerHTML:'',textContent:'',hidden:false,open:false});return elements.get(key);};
 return {elements,fields,report:createExecutiveReport({state:{user:{role:'admin'}},$,$$:()=>[],api,formData:()=>Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value])),todayText:()=> '2026-11-16',renderTable:()=>{},money:v=>Number(v||0).toFixed(2),esc:v=>String(v??'').replaceAll('<','&lt;'),toast:()=>{},switchTab:()=>{}})};
}
test('executive report renders every section and clears old output when loading fails',async()=>{
 let fail=false;const instance=ui(async()=>{if(fail)throw new Error('report unavailable');return fixture();});await instance.report.refreshExecutive();
 assert.equal(instance.elements.get('#executiveReport').hidden,false);assert.equal(instance.elements.get('#printExecutiveBtn').disabled,false);
 for(const id of ['Overview','Capital','Readiness','Procurement','Brief'])assert.ok(instance.elements.get('#executive'+id).innerHTML.length>0);
 fail=true;await instance.report.refreshExecutive();assert.equal(instance.elements.get('#executiveReport').hidden,true);assert.equal(instance.elements.get('#printExecutiveBtn').disabled,true);assert.equal(instance.elements.get('#executiveStatus').textContent,'report unavailable');
});
test('late report responses cannot replace a more recent filter result',async()=>{
 let first;let count=0;const instance=ui(()=>++count===1?new Promise(resolve=>first=resolve):Promise.resolve(fixture()));
 const older=instance.report.refreshExecutive();await instance.report.refreshExecutive();const stale=fixture();stale.range.start='STALE';first(stale);await older;
 assert.ok(!instance.elements.get('#executiveRange').textContent.includes('STALE'));
});
