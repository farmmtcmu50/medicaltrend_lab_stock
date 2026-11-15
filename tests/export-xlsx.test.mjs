import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {exportWorkbook} from '../src/export-xlsx.js';
test('export creates a real XLSX archive with numeric cells and safe literal text',()=>{
 const bytes=exportWorkbook({Items:[{name:'สินค้า & <A>',qty:2,note:'=1+1'}],Empty:[]});
 assert.equal(bytes[0],80);assert.equal(bytes[1],75);
 const files=unzipSync(bytes);assert.ok(files['xl/workbook.xml']);assert.ok(files['[Content_Types].xml']);
 const sheet=strFromU8(files['xl/worksheets/sheet1.xml']);assert.match(sheet,/สินค้า &amp; &lt;A&gt;/);assert.match(sheet,/<v>2<\/v>/);assert.match(sheet,/=1\+1/);assert.doesNotMatch(sheet,/<f>/);
});
