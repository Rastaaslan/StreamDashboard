import {test,expect} from '@playwright/test';
import express from 'express';
import path from 'node:path';
import type {Server} from 'node:http';
let server:Server,origin:string;
test.beforeAll(async()=>{const app=express();app.use('/mobile',express.static(path.resolve('apps/mobile')));app.get('/',(_req,res)=>res.send('<!doctype html><title>Audio transfer</title>'));server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});origin='http://127.0.0.1:'+(server.address() as {port:number}).port;});
test.afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});
test.beforeEach(async({page})=>{
 await page.goto(origin);
 await page.evaluate(async()=>{
  const stores=await import('/mobile/control/autonomy-store.js' as string),workspace=await import('/mobile/control/device-workspace.js' as string),transfers=await import('/mobile/control/sound-transfer-store.js' as string);
  const store=await stores.openReplica(workspace.LOCAL_SCOPE);await store.seed(workspace.newWorkspace({name:'Phone',role:'mobile'}));
  const transfer=await transfers.openSoundTransferStore(workspace.LOCAL_SCOPE);
  const bytes=Uint8Array.from({length:65536*2+9},(_,n)=>n%251),file=new File([bytes],'été.wav',{type:'audio/wav'});
  const spec={id:'transfer_fixture',soundId:'sound_fixture',name:'Été',filename:file.name,size:file.size,sha256:await transfers.hashSound(file)};
  (window as any).fixture={store,transfer,bytes,file,spec,transfers,scope:workspace.LOCAL_SCOPE,
   chunk:(offset:number)=>{let binary='';for(const byte of bytes.slice(offset,offset+65536))binary+=String.fromCharCode(byte);return btoa(binary);}};
 });
});
test('chunks survive reopening; publishing file, catalog and receipt is atomic and retries are idempotent',async({page})=>{
 const result=await page.evaluate(async()=>{
  const f=(window as any).fixture;await f.transfer.begin(f.spec,'peer-one');await f.transfer.append(f.spec.id,0,f.chunk(0),'peer-one');
  await f.store.reload();const before=f.store.view().sounds.sounds.length;f.transfer.close();
  f.transfer=await f.transfers.openSoundTransferStore(f.scope);
  const resumed=await f.transfer.begin(f.spec,'peer-one');
  await f.transfer.append(f.spec.id,0,f.chunk(0),'peer-one');
  for(const offset of [65536,131072])await f.transfer.append(f.spec.id,offset,f.chunk(offset),'peer-one');
  const receipt=await f.transfer.finish(f.spec.id,'peer-one'),again=await f.transfer.finish(f.spec.id,'peer-one');
  await f.store.reload();const blob=await f.store.soundAsset(f.spec.soundId);
  return {before,resumed,receipt,again,sounds:f.store.view().sounds.sounds,hash:await f.transfers.hashSound(blob),expected:f.spec.sha256};
 });
 expect(result.before).toBe(0);expect(result.resumed.offset).toBe(65536);expect(result.receipt.status).toBe('complete');expect(result.again).toEqual(result.receipt);
 expect(result.sounds).toHaveLength(1);expect(result.sounds[0].id).toBe('sound_fixture');expect(result.hash).toBe(result.expected);
});
test('wrong owner, reordered or replaced chunks, incomplete files and checksum failures never publish audio',async({page})=>{
 const result=await page.evaluate(async()=>{
  const f=(window as any).fixture,errors=[];
  await f.transfer.begin({...f.spec,sha256:'0'.repeat(64)},'peer-one');
  for(const work of [
   ()=>f.transfer.append(f.spec.id,0,f.chunk(0),'other-peer'),
   ()=>f.transfer.append(f.spec.id,65536,f.chunk(65536),'peer-one'),
   ()=>f.transfer.finish(f.spec.id,'peer-one'),
  ])try{await work();errors.push('accepted');}catch(error){errors.push((error as Error).message);}
  await f.transfer.append(f.spec.id,0,f.chunk(0),'peer-one');
  try{await f.transfer.append(f.spec.id,0,btoa('x'.repeat(65536)),'peer-one');errors.push('accepted');}catch(error){errors.push((error as Error).message);}
  for(const offset of [65536,131072])await f.transfer.append(f.spec.id,offset,f.chunk(offset),'peer-one');
  try{await f.transfer.finish(f.spec.id,'peer-one');errors.push('accepted');}catch(error){errors.push((error as Error).message);}
  await f.store.reload();return {errors,sounds:f.store.view().sounds.sounds,asset:!!await f.store.soundAsset(f.spec.soundId)};
 });
 expect(result.errors).toHaveLength(5);expect(result.errors).not.toContain('accepted');expect(result.sounds).toEqual([]);expect(result.asset).toBe(false);
});
test('permission withdrawal and concurrent identity replacement abort final publication without deleting the old content',async({page})=>{
 const result=await page.evaluate(async()=>{
  const f=(window as any).fixture;await f.transfer.begin(f.spec,'peer-one');
  for(const offset of [0,65536,131072])await f.transfer.append(f.spec.id,offset,f.chunk(offset),'peer-one');
  let refused=false;try{await f.transfer.finish(f.spec.id,'peer-one',()=>{throw Error('revoked');});}catch{refused=true;}
  await f.store.stage({['sound/'+f.spec.soundId]:{name:'Concurrent',enabled:true,volume:0.3}});
  let conflict=false;try{await f.transfer.finish(f.spec.id,'peer-one');}catch{conflict=true;}
  await f.store.reload();return {refused,conflict,sounds:f.store.view().sounds.sounds,asset:!!await f.store.soundAsset(f.spec.soundId)};
 });
 expect(result.refused).toBe(true);expect(result.conflict).toBe(true);expect(result.sounds[0].name).toBe('Concurrent');expect(result.asset).toBe(false);
});
test('a full staging area is bounded and cancelling an incomplete transfer does not publish or remove another file',async({page})=>{
 const result=await page.evaluate(async()=>{
  const f=(window as any).fixture;
  for(let n=0;n<4;n++)await f.transfer.begin({...f.spec,id:'upload_000'+n,soundId:'sound_000'+n},'peer-one');
  let full=false;try{await f.transfer.begin({...f.spec,id:'upload_0004'},'peer-one');}catch{full=true;}
  await f.transfer.cancel('upload_0000','peer-one');await f.transfer.begin({...f.spec,id:'upload_0004'},'peer-one');
  await f.store.reload();return {full,sounds:f.store.view().sounds.sounds};
 });
 expect(result.full).toBe(true);expect(result.sounds).toEqual([]);
});
test('the shared uploader reaches the Android executor with encrypted pairing identity and resumes a lost chunk response',async({page})=>{
 const result=await page.evaluate(async()=>{
  const f=(window as any).fixture,{createDeviceExecutor}=await import('/mobile/control/device-executor.js' as string),{uploadSound}=await import('/mobile/control/sound-transfer.js' as string),{migrateInstallation}=await import('/mobile/shared/installation.js' as string),{DEVICE_PERMISSIONS}=await import('/mobile/shared/device-permissions.js' as string);
  const model=migrateInstallation({id:'phone',platform:'android'});let enabled=false,lost=false,chunkCalls=0,plays=0;
  const bridge={call:async(operation:string)=>{if(operation==='load')return null;if(operation==='start')enabled=true;return {enabled,urls:['https://phone.local:48136']};},listen(){}};
  const executor=await createDeviceExecutor({bridge,installation:()=>model,runtime:async()=>({owner:{store:f.store},audio:{snapshot:()=>f.store.view().sounds,play:()=>{plays++;}}})});
  await executor.localRequest('/api/v2/settings',{expectedRevision:'0',remoteEnabled:true},'PUT');
  const pair=await executor.localRequest('/api/v1/remote/pairing',{permissions:Object.keys(DEVICE_PERMISSIONS)},'POST');
  const request=(path:string,body:any,token='')=>executor.handle({path,method:body===undefined?'GET':'POST',body:body===undefined?'':JSON.stringify(body),authorization:token?'Device '+token:'',remote:'fixture'});
  const enrolled=await request('/api/v1/remote/pair',{id:pair.id,code:pair.code,name:'PC'});
  const peers={request:async(url:string,{token,body}:any)=>{
   if(new URL(url).origin!=='https://phone.local:48136'||token!==enrolled.body.credential)throw Error('wrong destination');
   const response=await request(new URL(url).pathname,body,token);
   if(url.endsWith('/chunk')){chunkCalls++;if(!lost){lost=true;throw Error('lost response');}}
   return new Response(JSON.stringify(response.body),{status:response.status});
  }};
  const input={peers,origin:'https://phone.local:48136',token:enrolled.body.credential,file:f.file,name:f.spec.name,soundId:f.spec.soundId,expectedDeviceId:'phone'};
  let interrupted=false;try{await uploadSound(input);}catch{interrupted=true;}
  const receipt=await uploadSound(input);await f.store.reload();
  return {interrupted,receipt,chunkCalls,plays,sounds:f.store.view().sounds.sounds};
 });
 expect(result.interrupted).toBe(true);expect(result.receipt.id).toBe('sound_fixture');expect(result.chunkCalls).toBe(3);expect(result.plays).toBe(0);expect(result.sounds).toHaveLength(1);
});
