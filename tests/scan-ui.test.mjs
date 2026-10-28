import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('scan updates only the affected row and defers hidden views',async()=>{
 const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace('boot();','');
 const calls=[];const c=vm.createContext({window:{addEventListener(){}},console,setTimeout,clearTimeout,location:{hash:''},document:{querySelector:()=>({barcode:{focus(){}}}),querySelectorAll:()=>[]}});
 vm.runInContext(source,c);
 c.calls=calls;
 vm.runInContext(`state.stock=[{barcode:'BOX',quantity_sub:5},{barcode:'OTHER',quantity_sub:7}];
 api=async(path)=>{ calls.push(path);return path.endsWith('/preview')?{target:{is_package:true,quantity_sub:5},warnings:[]}:{barcode:'BOX',remaining_sub:3}; };
 stockWrite=async(path,body)=>api(path,{method:"POST",body});showScanResult=()=>{};
 renderStock=()=>{};toast=()=>{};
 refreshDashboard=async()=>calls.push('dashboard');`,c);
 await vm.runInContext("consume({barcode:'BOX',package_quantity:2})",c);
 assert.deepEqual(calls,['/api/consume/preview','/api/consume']);
 assert.equal(vm.runInContext('state.stock[0].quantity_sub',c),3);
 assert.equal(vm.runInContext('state.stock[1].quantity_sub',c),7);
 vm.runInContext("switchTab('dashboard')",c);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.at(-1),'dashboard');const count=calls.length;
 vm.runInContext("switchTab('dashboard')",c);assert.equal(calls.length,count);
});

async function workflowContext(){
 const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace('boot();','');
 const cache=new Map(),elements=new Map();
 const context=vm.createContext({console,setTimeout,clearTimeout,window:{addEventListener(){}},location:{hash:''},crypto:{randomUUID:()=>`request-${Math.random()}`},localStorage:{getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)},document:{querySelector:selector=>{if(!elements.has(selector))elements.set(selector,{classList:{toggle(){},remove(){}},textContent:'',innerHTML:''});return elements.get(selector);},querySelectorAll:()=>[]}});
 vm.runInContext(source,context);vm.runInContext("state.user={username:'test-user',role:'staff'};refreshAll=async()=>{};toast=()=>{};",context);
 return {context,cache};
}
test('lost stock response is recovered by request ID without submitting a new write',async()=>{
 const {context}=await workflowContext();context.requests=[];
 vm.runInContext(`api=async(path,opts)=>{requests.push({path,opts});if(path==='/api/receive')throw new Error('connection lost after commit');return {found:true,result:{ok:true,operation_id:'confirmed'}};};`,context);
 const result=await vm.runInContext("stockWrite('/api/receive',{item_id:'a',quantity:2})",context);
 assert.equal(result.operation_id,'confirmed');assert.equal(result.replayed,true);
 assert.equal(context.requests.length,2);assert.ok(context.requests[1].path.includes(context.requests[0].opts.body.request_id));
 assert.equal(vm.runInContext('readPendingStockWrite()',context),null);
});
test('uncertain writes persist and retry the exact same command; new writes are blocked',async()=>{
 const {context}=await workflowContext();context.requests=[];
 vm.runInContext(`api=async(path,opts)=>{requests.push({path,opts});if(path.startsWith('/api/operations/status'))return {found:false};throw new Error('offline');};`,context);
 await assert.rejects(vm.runInContext("stockWrite('/api/receive',{item_id:'a',quantity:2})",context),/ยืนยันผล/);
 const pending=vm.runInContext('readPendingStockWrite()',context);assert.ok(pending.body.request_id);
 await assert.rejects(vm.runInContext("stockWrite('/api/receive',{item_id:'a',quantity:2})",context),/ยังไม่ยืนยัน/);
 vm.runInContext(`api=async(path,opts)=>{requests.push({path,opts});return {ok:true,operation_id:'replayed'};};`,context);
 await vm.runInContext('sendPendingStockWrite(readPendingStockWrite())',context);
 const sent=context.requests.filter(r=>r.path==='/api/receive');assert.equal(sent.length,2);
 assert.equal(JSON.stringify(sent[0].opts.body),JSON.stringify(sent[1].opts.body));
 assert.equal(vm.runInContext('readPendingStockWrite()',context),null);
});
test('validation failure clears a pending key and does not leave the scanner locked',async()=>{
 const {context}=await workflowContext();vm.runInContext("api=async()=>{throw Object.assign(new Error('invalid'),{status:400});};",context);
 await assert.rejects(vm.runInContext("stockWrite('/api/receive',{quantity:0})",context),/invalid/);
 assert.equal(vm.runInContext('readPendingStockWrite()',context),null);
 assert.equal(vm.runInContext('workflowUi.busy',context),false);
});

test('near-expiry drilldown filters by exact machine and expiry bucket without mixing machines',async()=>{
 const {context}=await workflowContext();
 vm.runInContext(`state.analytics={near:[{machine:'iChroma',bucket:'หมดอายุ',lot:'A'},{machine:'iChroma',bucket:'30–59 วัน',lot:'B'},{machine:'iChroma Plus',bucket:'หมดอายุ',lot:'C'},{machine:'',bucket:'หมดอายุ',lot:'D'}]};`,context);
 const lots=expression=>JSON.parse(vm.runInContext(`JSON.stringify(${expression}.map(r=>r.lot))`,context));
 assert.deepEqual(lots("nearExpiryRows(state.analytics.near,{machine:'iChroma'})"),['A','B']);
 assert.deepEqual(lots("nearExpiryRows(state.analytics.near,{machine:'iChroma',bucket:'หมดอายุ'})"),['A']);
 assert.deepEqual(lots("nearExpiryRows(state.analytics.near,{machine:'ไม่ระบุเครื่อง'})"),['D']);
 assert.deepEqual(lots('nearExpiryRows(state.analytics.near)'),['A','B','C','D']);
});

test('PR suggestions move into draft, avoid duplicates, and return after removal or clearing',async()=>{
 const {context}=await workflowContext();context.CSS={escape:value=>value};
 vm.runInContext(`state.prSuggestionRows=[{item_id:'A',name:'A',status:'EXPIRED',main_unit:'Box',sub_unit:'Test',sub_per_main:5},{item_id:'B',name:'B',status:'EXPIRING',main_unit:'Bottle'},{item_id:'C',name:'C',status:'CRITICAL',main_unit:'Box'}];state.prRows=[];$('#prSource').value='expiring,reorder';renderPurchaseRequisition=()=>{};confirmBox=async()=>true;`,context);
 const ids=()=>JSON.parse(vm.runInContext('JSON.stringify(suggestedPrRows().map(r=>r.item_id))',context));
 assert.deepEqual(ids(),['A','B','C']);
 vm.runInContext(`$('[data-pr-qty="A"]').value='7';$('[data-pr-qty="B"]').value='9';addPrSuggestion('A');addPrSuggestion('A');`,context);
 assert.deepEqual(ids(),['B','C']);assert.equal(vm.runInContext('state.prRows.length',context),1);assert.equal(vm.runInContext('state.prRows[0].order_qty',context),7);
 vm.runInContext('state.prRows[0].order_qty=11;deletePrRow(state.prRows[0].id)',context);assert.deepEqual(ids(),['A','B','C']);assert.equal(vm.runInContext("state.prSuggestionQuantities.A",context),11);
 vm.runInContext('addAllVisiblePrSuggestions()',context);assert.deepEqual(ids(),[]);assert.equal(vm.runInContext("state.prRows.find(r=>r.item_id==='B').order_qty",context),9);
 await vm.runInContext('clearPurchaseRequisition()',context);assert.deepEqual(ids(),['A','B','C']);
 vm.runInContext("state.prRows=[{id:'manual-a',item_id:'A',source:'manual'}]",context);assert.deepEqual(ids(),['B','C']);
});

test('PR suggestion table contains only requested data columns plus selection and add controls',async()=>{
 const {context}=await workflowContext();
 vm.runInContext(`state.prSuggestionRows=[];state.prRows=[];$('#prSuggestedTable').querySelectorAll=()=>[];renderTable=(table,columns)=>{state.testSuggestionColumns=columns.map(c=>c[0]);};renderPrSuggestions();`,context);
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(state.testSuggestionColumns)',context)),['select','status','name','qty_main_display','order_qty','actions']);
});


test('PR filters toggle independently and combine matches without duplicates',async()=>{
 const {context}=await workflowContext();
 vm.runInContext(`state.prRows=[];state.prSuggestionRows=['EXPIRED','EXPIRING','REORDER','CRITICAL','OK'].map((status,i)=>({item_id:String(i),status}));$('#prSource').value='expiring';`,context);
 const ids=()=>JSON.parse(vm.runInContext('JSON.stringify(suggestedPrRows().map(r=>r.item_id))',context));
 assert.deepEqual(ids(),['0','1']);
 vm.runInContext("togglePrSource('reorder_point')",context);assert.deepEqual(ids(),['0','1','2']);
 vm.runInContext("togglePrSource('reorder')",context);assert.deepEqual(ids(),['0','1','2','3']);
 vm.runInContext("togglePrSource('expiring')",context);assert.deepEqual(ids(),['2','3']);
 vm.runInContext("togglePrSource('reorder')",context);assert.deepEqual(ids(),['2']);
 vm.runInContext("togglePrSource('reorder_point')",context);assert.deepEqual(ids(),[]);
});


test('stock value change uses closing minus opening and a shared symmetric scale',async()=>{
 const {context}=await workflowContext();
 const result=JSON.parse(vm.runInContext(`JSON.stringify(stockValueChanges([{item_id:'up',opening_value:100,closing_value:150},{item_id:'down',opening_value:200,closing_value:100},{item_id:'zero',opening_value:25,closing_value:25},{item_id:'round',opening_value:0.1,closing_value:0.3}]))`,context));
 assert.deepEqual(result.rows.map(r=>[r.item_id,r.change]),[['up',50],['round',0.2],['down',-100]]);assert.equal(result.max,100);
 assert.equal(vm.runInContext('stockValueChanges([]).max',context),1);
 assert.equal(vm.runInContext('stockValueChanges([{opening_value:0,closing_value:0}]).rows.length',context),0);
});


test('value chart sorts signed changes and combines machine and supplier filters',async()=>{
 const {context}=await workflowContext();
 vm.runInContext(`state.chartTest=[{name:'B',machine:'M1',supplier:'S1',closing_value:50},{name:'A',machine:'M1',supplier:'S2',opening_value:100},{name:'C',machine:'M2',supplier:'S1',closing_value:10}];`,context);
 const names=filters=>JSON.parse(vm.runInContext(`JSON.stringify(stockValueChanges(state.chartTest,${JSON.stringify(filters)}).rows.map(r=>r.name))`,context));
 assert.deepEqual(names({sort:'desc'}),['B','C','A']);assert.deepEqual(names({sort:'asc'}),['A','C','B']);assert.deepEqual(names({sort:'name'}),['A','B','C']);
 assert.deepEqual(names({machine:'M1',supplier:'S1'}),['B']);assert.deepEqual(names({machine:'M2',supplier:'S2'}),[]);
});

test('supplier PR preview groups chosen vendors and rejects unassigned or invalid quantities',async()=>{
 const {context}=await workflowContext();
 vm.runInContext(`state.suppliers=[{supplier_id:'A',name:'Alpha',is_active:1},{supplier_id:'B',name:'Beta',is_active:1},{supplier_id:'U',name:'Unknown',is_active:1,is_placeholder:1}];state.prRows=[{name:'one',supplier:'Alpha',order_qty:2},{name:'two',supplier:'Beta',order_qty:3},{name:'three',supplier:'alpha',order_qty:1}];`,context);
 const groups=JSON.parse(vm.runInContext('JSON.stringify(supplierPrGroups(state.prRows,state.suppliers))',context));assert.deepEqual(groups.map(g=>[g.supplier,g.rows.length]),[['Alpha',2],['Beta',1]]);
 assert.throws(()=>vm.runInContext("supplierPrGroups([{name:'bad',supplier:'Unknown',order_qty:1}],state.suppliers)",context));
 assert.throws(()=>vm.runInContext("supplierPrGroups([{name:'bad',supplier:'Alpha',order_qty:0}],state.suppliers)",context));
});


test('zero changes are excluded for all and specific vendors and machines in every sort mode',async()=>{
 const {context}=await workflowContext();
 vm.runInContext(`state.chartTest=[{name:'moving',machine:'M',supplier:'S',opening_value:10,closing_value:20,has_movement:true},{name:'offsetting',machine:'M',supplier:'S',opening_value:10,closing_value:10,has_movement:true},{name:'idle',machine:'M',supplier:'S',opening_value:10,closing_value:10,has_movement:false},{name:'rounded-zero',machine:'M',supplier:'S',opening_value:10,closing_value:10.001,has_movement:true}];`,context);
 for(const sort of ['asc','desc','name'])for(const machine of ['','M'])for(const supplier of ['','S']){
  const filters=JSON.stringify({sort,machine,supplier});
  assert.deepEqual(JSON.parse(vm.runInContext(`JSON.stringify(stockValueChanges(state.chartTest,${filters}).rows.map(r=>r.name))`,context)),['moving']);
 }
});


test('PR refresh ignores dashboard filters and never changes dashboard data',async()=>{
 const {context}=await workflowContext();context.calls=[];
 vm.runInContext(`state.dashboard=[{item_id:'filtered',status:'EXPIRED'}];state.analytics={marker:'dashboard'};$('#dashboardSearch').value='filtered';$('#dashboardMachineFilter').value='M';$('#prSource').value='expiring';renderPrSuggestions=()=>{};api=async path=>{calls.push(path);return {rows:[{item_id:'all-a',status:'EXPIRED'},{item_id:'all-b',status:'EXPIRING'}]};};`,context);
 await vm.runInContext('refreshPrSuggestions()',context);
 assert.deepEqual(context.calls,['/api/pr-suggestions']);
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(suggestedPrRows().map(r=>r.item_id))',context)),['all-a','all-b']);
 assert.equal(vm.runInContext('state.dashboard[0].item_id',context),'filtered');assert.equal(vm.runInContext('state.analytics.marker',context),'dashboard');
 vm.runInContext("state.dashboard=[]",context);assert.equal(vm.runInContext('suggestedPrRows().length',context),2);
});


test('item menu filtering retains the full master used by receiving PR and counts',async()=>{
 const {context}=await workflowContext();context.paths=[];
 vm.runInContext(`state.items=[];$('#itemSearch').value='Alpha';$('#itemMachineFilter').value='M1';$('#receiveItemSearch').value='Beta';$('#manualPrSearch').value='Beta';state.prSuggestionRows=[{item_id:'suggestion'}];state.dashboard=[{item_id:'dashboard'}];api=async path=>{paths.push(path);return {rows:[{item_id:'A',reagent_name:'Alpha',machine:'M1',supplier:'S1',is_active:1},{item_id:'B',reagent_name:'Beta',machine:'M2',supplier:'S2',is_active:1}],machines:['M1','M2']};};renderMachineFilter=()=>{};renderReceiveItems=()=>{state.receiveMaster=state.items.map(i=>i.item_id);};renderManualPrItems=()=>{state.manualMaster=state.items.map(i=>i.item_id);};renderTable=(table,columns,rows)=>{state.itemMenuResult=rows.map(r=>r.item_id);};`,context);
 await vm.runInContext('refreshItems()',context);
 assert.deepEqual(context.paths,['/api/items']);
 for(const key of ['items','receiveMaster','manualMaster'])assert.equal(vm.runInContext(`state.${key}.length`,context),2);
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(state.itemMenuResult)',context)),['A']);
 assert.equal(vm.runInContext("$('#receiveItemSearch').value",context),'Beta');assert.equal(vm.runInContext("$('#manualPrSearch').value",context),'Beta');
 assert.equal(vm.runInContext('state.dashboard[0].item_id',context),'dashboard');assert.equal(vm.runInContext('state.prSuggestionRows[0].item_id',context),'suggestion');
 vm.runInContext("$('#itemSearch').value='no match'",context);await vm.runInContext('refreshItems()',context);assert.equal(vm.runInContext('state.itemMenuResult.length',context),0);assert.equal(vm.runInContext('state.items.length',context),2);
});


test('item cost column is restricted to admin',async()=>{
 const {context}=await workflowContext();
 vm.runInContext("state.user.role='admin'",context);assert.equal(vm.runInContext("itemVisibleColumns().find(([key])=>key==='main_unit_price')[1]",context),'ราคาต้นทุน');
 vm.runInContext("state.user.role='staff'",context);assert.equal(vm.runInContext("itemVisibleColumns().some(([key])=>priceColumnKeys.has(key))",context),false);
});
