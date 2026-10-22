import {test,expect} from '@playwright/test';
import express from 'express';
import type {Server} from 'node:http';
import path from 'node:path';
let server:Server,origin:string;
test.beforeAll(async()=>{
  const app=express();app.use('/mobile',express.static(path.resolve('apps/mobile')));app.get('/fixture',(_q,r)=>r.send('<!doctype html><body></body>'));
  server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));origin='http://127.0.0.1:'+(server.address() as any).port;
});
test.afterAll(()=>server.close());

test('journal migrates cold proofs, survives reopening and admits one concurrent claimant',async({page})=>{
  await page.goto(origin+'/fixture');
  const result=await page.evaluate(async()=>{
    const {openReplica}=await import(String('/mobile/control/autonomy-store.js'));
    const {newWorkspace}=await import(String('/mobile/control/device-workspace.js'));
    let store=await openReplica('journal-test');await store.seed(newWorkspace({name:'Test'}));
    await store.draft('youtubePreparations',Object.fromEntries(Array.from({length:200},(_,i)=>['old_'+i,{status:'succeeded',broadcastId:'broadcast_'+i}])));
    const hot=Object.keys(store.record.drafts.youtubePreparations).length;
    store.close();store=await openReplica('journal-test');const other=await openReplica('journal-test');
    const old=await store.journalRead('youtubePreparations','old_0');
    const attempts=await Promise.all([store,other].map(s=>s.journalClaim('youtubePreparations','same_id',{status:'running'})));
    await store.journalSave('youtubePreparations','same_id',{status:'succeeded',broadcastId:'only-once'});
    const replay=await other.journalClaim('youtubePreparations','same_id',{status:'running'});
    store.close();other.close();return {hot,old,attempts,replay};
  });
  expect(result.hot).toBe(128);expect(result.old.broadcastId).toBe('broadcast_0');
  expect(result.attempts.filter((v:any)=>v.created)).toHaveLength(1);
  expect(result.replay).toEqual({created:false,value:{status:'succeeded',broadcastId:'only-once'}});
});

test('audio cleanup protects active references, restores files and rechecks a stale preview',async({page})=>{
  await page.goto(origin+'/fixture');
  const result=await page.evaluate(async()=>{
    const {openReplica}=await import(String('/mobile/control/autonomy-store.js'));
    const {newWorkspace}=await import(String('/mobile/control/device-workspace.js'));
    const {audioStorage}=await import(String('/mobile/control/audio-storage.js'));
    const store=await openReplica('storage-test');await store.seed(newWorkspace({name:'Test'}));
    const id=await store.addSound(new File(['audio-fixture'],'jingle.wav',{type:'audio/wav'}),'Jingle');
    await store.stage({['sound/'+id]:null});const preview=await audioStorage(store.scope);
    await store.draft('soundLibraryJobs',{copy:{status:'pending',items:[{id}]}});
    let protectedError='';try{await audioStorage(store.scope,preview.retained);}catch(e){protectedError=String(e);}
    await store.draft('soundLibraryJobs',{copy:{status:'completed',items:[{id}]}});
    await audioStorage(store.scope,preview.retained,indexedDB,'restore');await store.reload();
    const restored=store.view().sounds.sounds.some((s:any)=>s.id===id);
    let staleError='';try{await audioStorage(store.scope,preview.retained);}catch(e){staleError=String(e);}
    await store.stage({['sound/'+id]:null});await audioStorage(store.scope,(await audioStorage(store.scope)).retained);
    const gone=(await store.soundAsset(id))===undefined;store.close();return {protectedError,restored,staleError,gone};
  });
  expect(result.protectedError).toContain('transfert');expect(result.restored).toBe(true);expect(result.staleError).toContain('catalogue');expect(result.gone).toBe(true);
});

test('YouTube polling preserves a thousand unchanged message nodes',async({page})=>{
  await page.goto(origin+'/fixture');
  const result=await page.evaluate(async()=>{
    const {createYouTubeChat}=await import(String('/mobile/control/youtube-chat.js'));
    const root=document.createElement('div');document.body.append(root);let calls=0;
    const value={status:'connected',messages:Array.from({length:1000},(_,i)=>({id:String(i),author:'Auteur',text:'Message '+i}))};
    const chat=createYouTubeChat(root,{request:async()=>{calls++;return value;}});
    chat.update({enabled:true,broadcastId:'test',sourceKey:'local'});
    while(root.querySelectorAll('[data-message-id]').length!==1000)await new Promise(r=>setTimeout(r,10));
    const before=[...root.querySelectorAll('[data-message-id]')];chat.refresh();
    while(calls<2)await new Promise(r=>setTimeout(r,10));await new Promise(r=>setTimeout(r,0));
    const after=[...root.querySelectorAll('[data-message-id]')];chat.destroy();return before.filter((node,i)=>node===after[i]).length;
  });
  expect(result).toBe(1000);
});

test('default phone navigation retains tools and unsaved forms across polling',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>{
    localStorage.setItem('sd2.device',JSON.stringify({version:1,name:'Test',role:'mobile',configured:true}));
    (window as any).StreamDashboardNative={setKeepAwake(){}};
  });
  await page.goto(origin+'/mobile/control/');
  await expect(page.locator('nav button:visible')).toHaveCount(4);
  await expect(page.locator('nav button:visible')).toHaveText(['◉ Le live','▦ Mon Deck','▤ Planning & événements','⚙ Configuration']);
  await page.locator('.deck-banks [data-page="sounds"]').click();await expect(page.locator('h1')).toHaveText('Soundboard');
  await page.locator('nav [data-page="live"]').click();await page.locator('#live-controls [data-page="activity"]').click();await expect(page.locator('h1')).toHaveText('Activité');
  await page.locator('nav [data-page="deck"]').click();await expect(page.locator('h1')).toHaveText('Mon Deck');
  await page.locator('nav [data-page="settings"]').click();
  await page.locator('#platform-form [name="broadcastId"]').fill('unsaved-broadcast');
  await page.locator('#platform-form [name="channelId"]').fill('unsaved-channel');
  await page.waitForTimeout(3200);
  await expect(page.locator('#platform-form [name="broadcastId"]')).toHaveValue('unsaved-broadcast');
  await expect(page.locator('#platform-form [name="channelId"]')).toHaveValue('unsaved-channel');
  await expect(page.locator('#platform-form [name="channelId"]')).toBeFocused();
  await page.locator('[data-tab="profile"]').click();await page.locator('[data-task="navigation-mode"]').click();
  await expect(page.locator('nav button:visible')).toHaveCount(5);
});


test('version 2 replica upgrade preserves data, blobs and old operation proofs',async({page})=>{
  await page.goto(origin+'/fixture');
  const result=await page.evaluate(async()=>{
    const {newWorkspace}=await import(String('/mobile/control/device-workspace.js'));
    const workspace=newWorkspace({name:'Before upgrade'});
    const old=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('streamdashboard-autonomy-v1',2);r.onupgradeneeded=()=>{r.result.createObjectStore('replicas');r.result.createObjectStore('assets');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise<void>((resolve,reject)=>{const tx=old.transaction(['replicas','assets'],'readwrite');tx.objectStore('replicas').put({...workspace,pending:[],drafts:{youtubePreparations:{old_proof:{status:'succeeded',broadcastId:'preserved'}}}},'upgrade-test');tx.objectStore('assets').put(new Blob(['preserved audio']),'upgrade-test/audio');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});old.close();
    const {openReplica}=await import(String('/mobile/control/autonomy-store.js'));const store=await openReplica('upgrade-test');
    const data={name:store.view().data.host.hostname,blob:await (await store.soundAsset('audio')).text(),proof:await store.journalRead('youtubePreparations','old_proof')};store.close();return data;
  });
  expect(result).toEqual({name:'Before upgrade',blob:'preserved audio',proof:{status:'succeeded',broadcastId:'preserved'}});
});


test('a blocked upgrade closes its late connection after the old window exits',async({page})=>{
  await page.goto(origin+'/fixture');
  const result=await page.evaluate(async()=>{
    const old=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('streamdashboard-autonomy-v1',2);r.onupgradeneeded=()=>{r.result.createObjectStore('replicas');r.result.createObjectStore('assets');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const {openReplicaDatabase}=await import(String('/mobile/control/replica-identity.js'));let blocked='';try{await openReplicaDatabase();}catch(error){blocked=String(error);}old.close();
    const removed=await new Promise<boolean>((resolve,reject)=>{const r=indexedDB.deleteDatabase('streamdashboard-autonomy-v1');r.onsuccess=()=>resolve(true);r.onblocked=()=>resolve(false);r.onerror=()=>reject(r.error);});
    return {blocked,removed};
  });
  expect(result.blocked).toContain('Fermez les autres fenêtres');expect(result.removed).toBe(true);
});
