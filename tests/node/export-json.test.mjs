import test from 'node:test';
import assert from 'node:assert/strict';
import {exportJSON} from '../../apps/mobile/control/export-json.js';
test('Android exports the JSON through its document bridge and reports refusal without a fake download',async()=>{
 let shared;
 await exportJSON({format:'backup',version:1},'backup.json',{native:{shareDocument:(text,name)=>{shared={text,name};return '';}}});
 assert.deepEqual(JSON.parse(shared.text),{format:'backup',version:1});assert.equal(shared.name,'backup.json');
 await assert.rejects(exportJSON({},'backup.json',{native:{shareDocument:()=> 'Storage unavailable'}}),/Storage unavailable/);
 await assert.rejects(exportJSON({},'backup.json',{native:{isAndroid:()=>true}}),/Mettez à jour/);
});
