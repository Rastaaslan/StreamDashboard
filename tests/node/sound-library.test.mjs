import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createSoundLibraryExport,portableSound} from '../../apps/mobile/shared/sound-library.js';
import {runSoundLibraryCopy} from '../../apps/mobile/control/sound-library-copy.js';
import {uploadSound} from '../../apps/mobile/control/sound-transfer.js';
const sound={id:'legacy:1',name:'Ambiance',favorite:true,volume:0.4,enabled:false,cooldownMs:300,category:'Musique',playbackMode:'mix',monitoringMode:'monitor',source:'private/path.wav',outputId:'obs'};
const bytes=Uint8Array.from({length:65539},(_,i)=>i%251);
const hash=async blob=>createHash('sha256').update(new Uint8Array(await blob.arrayBuffer())).digest('hex');
function fixture(){let time=0,allowed=true;const library=createSoundLibraryExport({uuid:randomUUID,now:()=>time,list:()=>[sound],load:async()=>({blob:new Blob([bytes]),filename:'ambiance.wav'}),hash});return {library,guard:()=>{if(!allowed)throw Error('revoked');},revoke:()=>{allowed=false;},expire:()=>{time+=300001;}};}
test('export excludes local paths and outputs and holds immutable bytes for the authorized owner',async()=>{
 const {library}=fixture(),listed=await library({operation:'list'},'a');assert.deepEqual(listed.items,[{id:sound.id,...portableSound(sound)}]);
 const opened=await library({operation:'open',soundId:sound.id,settings:sound},'a');assert.equal(opened.sha256,await hash(new Blob([bytes])));
 const read=await library({operation:'read',id:opened.id,offset:65536},'a');assert.deepEqual(Buffer.from(read.chunk,'base64'),Buffer.from(bytes.slice(65536)));
 await assert.rejects(library({operation:'read',id:opened.id,offset:0},'b'),/contrôleur/);
 await assert.rejects(library({operation:'close',id:opened.id},'b'),/contrôleur/);
 await library({operation:'close',id:opened.id},'a');await assert.rejects(library({operation:'read',id:opened.id,offset:0},'a'),/expirée/);
});
test('revoked permissions, changed metadata, missing IDs and invalid offsets cannot export files',async()=>{
 const f=fixture();
 await assert.rejects(f.library({operation:'open',soundId:'../private',settings:sound},'a'),/invalide/);
 await assert.rejects(f.library({operation:'open',soundId:sound.id,settings:{...sound,volume:0.1}},'a'),/changé/);
 const open=await f.library({operation:'open',soundId:sound.id,settings:sound},'a');
 for(const offset of [-1,1,65536*2])await assert.rejects(f.library({operation:'read',id:open.id,offset},'a'),/invalide/);
 f.revoke();await assert.rejects(f.library({operation:'read',id:open.id,offset:0},'a',f.guard),/revoked/);
 f.expire();await assert.rejects(f.library({operation:'read',id:open.id,offset:0},'a'),/expirée/);
});
test('export staging is bounded and releases its slots on close or expiry',async()=>{
 const f=fixture(),opened=[];for(let n=0;n<8;n++)opened.push(await f.library({operation:'open',soundId:sound.id,settings:sound},'a'));
 await assert.rejects(f.library({operation:'open',soundId:sound.id,settings:sound},'a'),/Huit/);
 await f.library({operation:'close',id:opened[0].id},'a');await f.library({operation:'open',soundId:sound.id,settings:sound},'a');f.expire();await f.library({operation:'open',soundId:sound.id,settings:sound},'a');
});
test('a lost upload acknowledgement resumes the same file and preserves the source and portable metadata',async()=>{
 const {library}=fixture();let saved={id:'copy_test_123',source:{id:'a'},target:{id:'b'},sourceWorkspace:'a',targetWorkspace:'b',items:[sound],status:'pending'},uploads=0;
 const inputs=[];const options={read:(_target,body)=>library(body,'a'),save:async job=>{saved=job;},upload:async(_target,input)=>{inputs.push(input);if(++uploads===1)throw Error('lost reply');return {id:input.soundId};}};
 await assert.rejects(runSoundLibraryCopy(saved,options),/lost reply/);assert.equal(saved.items[0].sha256,await hash(new Blob([bytes])));assert.equal(saved.items[0].complete,undefined);
 await runSoundLibraryCopy(saved,options);assert.equal(saved.status,'completed');assert.equal(inputs[0].transferId,inputs[1].transferId);assert.deepEqual(inputs[1].settings,portableSound(sound));assert.equal(await hash(inputs[1].file),saved.items[0].sha256);
 assert.equal((await library({operation:'list'},'a')).items.length,1);
});
test('modified source files and corrupt chunks never reach the destination',async()=>{
 const {library}=fixture();let uploads=0;const job={id:'copy_test_123',source:{id:'a'},target:{id:'b'},items:[{...sound,sha256:'0'.repeat(64),size:bytes.length}]};
 const base={read:(_target,body)=>library(body,'a'),save:async()=>{},upload:async()=>{uploads++;}};
 await assert.rejects(runSoundLibraryCopy(job,base),/source a changé/);
 delete job.items[0].sha256;
 await assert.rejects(runSoundLibraryCopy(job,{...base,read:async(target,body)=>{const result=await base.read(target,body);if(body.operation==='read')result.chunk=Buffer.alloc(Buffer.from(result.chunk,'base64').length).toString('base64');return result;}}),/Empreinte/);assert.equal(uploads,0);
});
test('an older destination cannot silently discard portable settings or workspace checks',async()=>{
 let requests=0;await assert.rejects(uploadSound({file:new Blob([bytes]),filename:'a.wav',name:sound.name,settings:sound,expectedWorkspace:'target',transport:async()=>{requests++;return {device:{id:'target',platform:'windows'}};}}),/Mettez à jour/);assert.equal(requests,1);
});
