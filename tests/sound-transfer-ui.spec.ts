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

test('a whole library resumes after a lost publication reply and copies back without changing identities or settings',async({page})=>{
 const result=await page.evaluate(async()=>{
  const f=(window as any).fixture,{openReplica}=await import('/mobile/control/autonomy-store.js' as string),{newWorkspace}=await import('/mobile/control/device-workspace.js' as string),{createLocalSoundLibrary,uploadLocalSound}=await import('/mobile/control/local-sound-library.js' as string),{runSoundLibraryCopy}=await import('/mobile/control/sound-library-copy.js' as string);
  const a=f.store,b=await openReplica('second-device');await b.seed(newWorkspace({name:'Second',role:'control'}));
  const first=await a.addSound(f.file,'Ambiance'),second=await a.addSound(new File(['short'],'b.wav'),'Court');
  await a.stage({['sound/'+first]:{...a.view().sounds.sounds.find((v:any)=>v.id===first),favorite:true,enabled:false,volume:0.4,category:'Musique',playbackMode:'mix',cooldownMs:500}});
  const stores:any={a,b},exports:any={a:createLocalSoundLibrary(a),b:createLocalSoundLibrary(b)};let lose=true,uploads=0;
  const save=async(job:any)=>a.draft('copyFixture',job),options={save,read:async(d:any,body:any)=>exports[d.id](body,'controller'),upload:async(d:any,input:any)=>{const target=stores[d.id];const result=await uploadLocalSound(target,input,{id:d.id,platform:'android'},target.record.workspace);uploads++;if(lose){lose=false;throw Error('lost reply');}return result;}};
  const source=await exports.a({operation:'list'},'controller'),job={id:'copy_browser_123',source:{id:'a'},target:{id:'b'},sourceWorkspace:a.record.workspace,targetWorkspace:b.record.workspace,items:source.items,status:'pending'};
  let interrupted=false;try{await runSoundLibraryCopy(job,options);}catch{interrupted=true;}
  await a.reload();await b.reload();const before=b.view().sounds.sounds.length,partial=a.record.drafts.copyFixture;
  await runSoundLibraryCopy(partial,options);await b.reload();await a.reload();
  const finished=a.record.drafts.copyFixture,target=b.view().sounds.sounds;
  const back={...job,id:'copy_reverse_123',source:{id:'b'},target:{id:'a'},sourceWorkspace:b.record.workspace,targetWorkspace:a.record.workspace,items:(await exports.b({operation:'list'},'controller')).items};
  await runSoundLibraryCopy(back,options);await a.reload();
  const final=a.view().sounds.sounds;
  await b.stage({['sound/'+first]:{...b.view().sounds.sounds.find((v:any)=>v.id===first),volume:0.8}});
  let conflict=false;try{await runSoundLibraryCopy({...job,id:'copy_conflict_123'},options);}catch{conflict=true;}
  await b.reload();const edited=b.view().sounds.sounds.find((v:any)=>v.id===first).volume;
  await b.stage({['sound/'+first]:null});let deleted=false;try{await runSoundLibraryCopy(job,options);}catch{deleted=true;}
  await b.reload();const remainedDeleted=!b.view().sounds.sounds.some((v:any)=>v.id===first);
  return {interrupted,before,finished,target,final,uploads,conflict,edited,deleted,remainedDeleted,ids:[first,second],sha:await f.transfers.hashSound(await b.soundAsset(first)),expected:await f.transfers.hashSound(f.file)};
 });
 expect(result.interrupted).toBe(true);expect(result.before).toBe(1);expect(result.finished.status).toBe('completed');expect(result.target).toHaveLength(2);expect(result.final).toHaveLength(2);expect(result.uploads).toBe(5);expect(result.sha).toBe(result.expected);
 expect(result.target.map((v:any)=>v.id)).toEqual(result.ids);expect(result.target[0]).toMatchObject({favorite:true,enabled:false,volume:0.4,category:'Musique',playbackMode:'mix',cooldownMs:500,outputId:'device-default'});
 expect(result).toMatchObject({conflict:true,edited:0.8,deleted:true,remainedDeleted:true});
});

test('Android exports require management permissions, the right workspace and a non-revoked pairing',async({page})=>{
 const result=await page.evaluate(async()=>{
  const f=(window as any).fixture,{createDeviceExecutor}=await import('/mobile/control/device-executor.js' as string),{migrateInstallation}=await import('/mobile/shared/installation.js' as string),{DEVICE_PERMISSIONS}=await import('/mobile/shared/device-permissions.js' as string);
  const model=migrateInstallation({id:'phone',platform:'android'});let enabled=false;
  const executor=await createDeviceExecutor({bridge:{call:async(op:string)=>{if(op==='load')return null;if(op==='start')enabled=true;return {enabled,urls:[]};},listen(){}},installation:()=>model,runtime:async()=>({owner:{store:f.store},audio:{snapshot:()=>f.store.view().sounds}})});
  await executor.localRequest('/api/v2/settings',{expectedRevision:'0',remoteEnabled:true},'PUT');
  const soundId=await f.store.addSound(f.file,'Export');
  const pair=async(permissions:string[])=>{const code=await executor.localRequest('/api/v1/remote/pairing',{permissions},'POST');return (await executor.handle({path:'/api/v1/remote/pair',method:'POST',body:JSON.stringify({id:code.id,code:code.code}),remote:'fixture'})).body;};
  const limited=await pair(['observe','audio']),full=await pair(Object.keys(DEVICE_PERMISSIONS));
  const request=(credential:string,body:any)=>executor.handle({path:'/api/v2/sounds/export',method:'POST',body:JSON.stringify(body),authorization:'Device '+credential});
  const denied=await request(limited.credential,{operation:'list',workspace:'device:phone'}),wrong=await request(full.credential,{operation:'list',workspace:'wrong'});
  const items=(await request(full.credential,{operation:'list',workspace:'device:phone'})).body.items;
  const opened=await request(full.credential,{operation:'open',workspace:'device:phone',soundId,settings:items[0]});
  const chunk=await request(full.credential,{operation:'read',workspace:'device:phone',id:opened.body.id,offset:0});
  await executor.localRequest('/api/v1/remote/devices/'+full.deviceId+'/revoke',{},'POST');
  const revoked=await request(full.credential,{operation:'read',workspace:'device:phone',id:opened.body.id,offset:65536});
  return {denied:denied.status,wrong:wrong.status,opened:opened.status,chunk:chunk.status,size:atob(chunk.body.chunk).length,revoked:revoked.status,items};
 });
 expect(result).toMatchObject({denied:403,wrong:409,opened:200,chunk:200,size:65536,revoked:401});expect(result.items[0]).not.toHaveProperty('source');
});

test('library copy interface previews metadata, persists interruption and resumes the retained job',async({page})=>{
 await page.evaluate(async()=>{
  const f=(window as any).fixture,{createSoundLibraryUI}=await import('/mobile/control/sound-library-ui.js' as string),{createLocalSoundLibrary}=await import('/mobile/control/local-sound-library.js' as string);
  const id=await f.store.addSound(f.file,'Ambiance');const read=createLocalSoundLibrary(f.store);let fail=true;
  const ui=createSoundLibraryUI({devices:async()=>[{id:'a',name:'Téléphone'},{id:'b',name:'PC'}],snapshot:async(d:any)=>({workspace:d.id}),store:async()=>f.store,modal:(html:string)=>{document.body.innerHTML=html;},esc:(v:any)=>String(v),changed:async()=>{},read:async(_d:any,body:any)=>read(body,'local'),upload:async(_d:any,input:any)=>{if(fail){fail=false;throw Error('Destination déconnectée');}return {id:input.soundId};}});
  document.addEventListener('submit',event=>{event.preventDefault();void ui.submit(event.target).catch((error:any)=>{(window as any).copyError=error.message;});});
  document.addEventListener('click',event=>{const button=(event.target as HTMLElement).closest('button[data-task]') as HTMLElement;if(button)void ui.task(button.dataset.task,button).catch((error:any)=>{(window as any).copyError=error.message;});});
  await ui.task('sound-library');(window as any).copyUi={ui,id};
 });
 await page.getByRole('button',{name:'Prévisualiser la copie'}).click();await expect(page.getByRole('heading',{name:'Confirmer la copie audio'})).toBeVisible();await expect(page.getByText('Ambiance · Général')).toBeVisible();
 await page.getByRole('button',{name:'Copier la bibliothèque',exact:true}).click();await expect(page.getByText('Destination déconnectée')).toBeVisible();
 await page.getByRole('button',{name:'Reprendre',exact:true}).click();await expect(page.getByText('1 / 1 fichiers confirmés · Terminé')).toBeVisible();
 const saved=await page.evaluate(async()=>{const store=(window as any).fixture.store;await store.reload();return Object.values(store.record.drafts.soundLibraryJobs);});expect(saved).toHaveLength(1);
});

test('legacy audio acquires a verified fingerprint and can return to its original Android without replacement',async({page})=>{
 const result=await page.evaluate(async()=>{
  const f=(window as any).fixture,{uploadLocalSound}=await import('/mobile/control/local-sound-library.js' as string);
  const id=await f.store.addSound(f.file,'Ancien');
  // Reproduce the pre-fingerprint metadata, retaining the original Blob.
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('streamdashboard-autonomy-v1',2);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction('replicas','readwrite'),table=tx.objectStore('replicas'),request=table.get(f.scope);request.onsuccess=()=>{const value=request.result;delete value.localAssets[id].sha256;table.put(value,f.scope);};tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();
  const receipt=await uploadLocalSound(f.store,{file:f.file,name:'Ancien',soundId:id,transferId:'legacy_return_fixture',expectedWorkspace:f.store.record.workspace},{id:'phone',platform:'android'},f.store.record.workspace);
  await f.store.reload();const hash=f.store.record.localAssets[id].sha256;
  let replacement=false;try{await uploadLocalSound(f.store,{file:new File(['different'],'other.wav'),name:'Ancien',soundId:id,transferId:'legacy_conflict_fixture',expectedWorkspace:f.store.record.workspace},{id:'phone',platform:'android'},f.store.record.workspace);}catch{replacement=true;}
  return {receipt,hash,expected:f.spec.sha256,replacement,sounds:f.store.view().sounds.sounds,actual:await f.transfers.hashSound(await f.store.soundAsset(id))};
 });
 expect(result.receipt.id).toBe(result.sounds[0].id);expect(result.hash).toBe(result.expected);expect(result.actual).toBe(result.expected);expect(result.replacement).toBe(true);expect(result.sounds).toHaveLength(1);
});
