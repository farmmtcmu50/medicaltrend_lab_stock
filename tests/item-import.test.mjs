import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs/dist/exceljs.min.js';
import {itemTemplate,readItemWorkbook,validateImportRows} from '../src/item-import.js';
const admin={role:'admin'},db={prepare(sql){return {async all(){return {results:sql.includes('machines')?[{name:'Manual'}]:[{supplier_id:'S',name:'Supplier A'}]};}};}};
async function fixture(){const response=await itemTemplate({DB:db},admin),book=new ExcelJS.Workbook();await book.xlsx.load(new Uint8Array(await response.arrayBuffer()));return book;}
test('template is a real styled XLSX with blank input, instructions and registry dropdowns',async()=>{
 const book=await fixture(),sheet=book.getWorksheet('สินค้า');assert.equal(sheet.getCell('A1').value,'ชื่อสินค้า');assert.equal(sheet.getCell('A2').value,null);assert.ok(book.getWorksheet('วิธีใช้และตัวอย่าง'));assert.equal(sheet.getCell('B2').dataValidation.formulae[0],'MachineOptions');
 sheet.addRow([]);sheet.getRow(2).values=['สินค้าใหม่','Manual','Supplier A','กล่อง',1,'ชิ้น',10,7,20,500];
 const rows=await readItemWorkbook(new Uint8Array(await book.xlsx.writeBuffer()),admin);assert.equal(rows.length,1);assert.equal(rows[0].excel_row,2);assert.equal(Number(rows[0].main_unit_price),500);
});
test('parser rejects missing headers empty sheets and formulas',async()=>{
 const book=await fixture();await assert.rejects(readItemWorkbook(new Uint8Array(await book.xlsx.writeBuffer()),admin),/ยังไม่มีข้อมูล/);
 const sheet=book.getWorksheet('สินค้า');sheet.getRow(2).values=['A','Manual','Supplier A','Box',0,'',1,0,0,{formula:'1+1',result:2}];
 const rows=await readItemWorkbook(new Uint8Array(await book.xlsx.writeBuffer()),admin);assert.match(rows[0].parse_errors.join(' '),/สูตร/);
 sheet.getCell('A1').value='Wrong';await assert.rejects(readItemWorkbook(new Uint8Array(await book.xlsx.writeBuffer()),admin),/หัวคอลัมน์/);
 await assert.rejects(readItemWorkbook(new Uint8Array([1,2,3]),admin),/XLSX/);
});
test('validation checks all rows and normalizes no-sub-unit products and cost',async()=>{
 const env={DB:{prepare(){return {};},async batch(){return [{results:[{name:'Manual'}]},{results:[{supplier_id:'S',name:'Supplier A'}]},{results:[]}];}}};
 const row={excel_row:2,reagent_name:'A',machine:'manual',supplier:'supplier a',main_unit:'Box',has_sub_unit:0,lead_time_days:0,reorder_point_sub:5,main_unit_price:25};
 const result=await validateImportRows(env,admin,[row,{...row,excel_row:3}]);assert.deepEqual(result[0].errors,[]);assert.equal(result[0].data.sub_unit,'Box');assert.equal(result[0].data.sub_per_main,1);assert.equal(result[0].data.unit_price,25);assert.match(result[1].errors.join(' '),/ซ้ำ/);
 const invalid=(await validateImportRows(env,admin,[{...row,machine:'Wrong',lead_time_days:-1,main_unit_price:'NaN'}]))[0];assert.ok(invalid.errors.length>=3);
});
