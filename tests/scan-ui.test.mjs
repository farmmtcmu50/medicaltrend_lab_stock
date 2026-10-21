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
