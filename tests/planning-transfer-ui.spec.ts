import {test,expect} from '@playwright/test';
import express from 'express';
import path from 'node:path';
import type {Server} from 'node:http';
let server:Server,origin:string;
test.beforeAll(async()=>{const app=express();app.use('/mobile',express.static(path.resolve('apps/mobile')));app.get('/',(_req,res)=>res.send('<!doctype html><title>Planning transfer</title>'));server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});origin='http://127.0.0.1:'+(server.address() as {port:number}).port;});
test.afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});
test.beforeEach(async({page})=>{
 await page.goto(origin);
 await page.evaluate(async()=>{
  const {openReplica}=await import('/mobile/control/autonomy-store.js' as string),{newWorkspace}=await import('/mobile/control/device-workspace.js' as string),{createLocalPlanning}=await import('/mobile/control/local-planning.js' as string),{createExecutorSync}=await import('/mobile/control/executor-sync.js' as string);
  const source=await openReplica('source'),target=await openReplica('target'),remote=await openReplica('https://phone.test:48136');
  await source.seed(newWorkspace({name:'PC'}));await target.seed(newWorkspace({name:'Phone'}));
  await remote.seed({workspace:'device:phone',bundle:target.view()});
  const item={id:'event_transferred',title:'Événement publié',category:'live',ownership:'LOCAL',editable:true,startAtUtc:'2030-11-01T18:00:00.000Z',endAtUtc:'2030-11-01T19:00:00.000Z',desiredPublication:{local:true,twitch:true,google:true},providers:{twitch:{status:'synced',remoteId:'segment-1',accountId:'channel-1'},google:{status:'synced',remoteId:'event-1',calendarId:'calendar-1',remoteRevision:'etag-1',creationId:'stable-id'}}};
  let effects=0,allowed=true;const providers={adapters:new Proxy({},{get(){effects++;throw Error('Provider I/O during transfer');}})};
  const planning=createLocalPlanning({store:target,providers}),sourcePlanning=createLocalPlanning({store:source,providers});
  const makeSync=()=>createExecutorSync({runtime:async()=>({owner:{store:target},planning}),workspace:()=> 'device:phone',authorize:()=>{if(!allowed)throw Error('revoked');},requireRole:()=>{if(!allowed)throw Error('stopped');}});
  (window as any).fixture={source,target,remote,item,planning,sourcePlanning,makeSync,effects:()=>effects,revoke:()=>{allowed=false;}};
 });
});
test('a planning handoff from a PC to Android preserves publication journals and durably removes source ownership',async({page})=>{
 const result=await page.evaluate(async()=>{
  const f=(window as any).fixture;await f.source.commitPlanning([f.item]);await f.remote.importLocal('source');await f.source.reload();
  const body={workspace:'device:phone',edit:f.remote.record.pending[0]},first=await f.makeSync()({},body),second=await f.makeSync()({},body);
  await f.target.reload();let sourceBlocked=false;try{await f.sourcePlanning.route('/api/v2/planning/'+f.item.id,{...f.item,title:'Changed'},'PUT');}catch{sourceBlocked=true;}
  await f.remote.accept({workspace:body.workspace,bundle:f.target.view(),receipt:second},body.edit.id);
  return {first,second,sourceBlocked,source:f.source.view().data.host.planning,target:f.target.view().data.host.planning,pending:f.remote.record.pending,effects:f.effects(),expected:f.item};
 });
 expect(result.first.status).toBe('applied');expect(result.second).toEqual(result.first);expect(result.sourceBlocked).toBe(true);
 expect(result.source[0].transferredTo).toBe('device:phone');expect(result.target).toEqual([result.expected]);expect(result.pending).toEqual([]);expect(result.effects).toBe(0);
});
test('an existing identity on Android is preserved and an ambiguous publication cannot be handed off',async({page})=>{
 const result=await page.evaluate(async()=>{
  const f=(window as any).fixture;await f.target.commitPlanning([{...f.item,title:'Existing'}]);
  const edit={id:'transfer_conflict',key:'planningTransfer/'+f.item.id,base:null,value:f.item};
  const receipt=await f.makeSync()({},{workspace:'device:phone',edit});
  await f.source.commitPlanning([{...f.item,providers:{google:{status:'error',uncertainCreate:{event:f.item}}}}]);
  let blocked=false;try{await f.remote.importLocal('source');}catch{blocked=true;}
  await f.source.reload();await f.target.reload();return {receipt,blocked,source:f.source.view().data.host.planning,target:f.target.view().data.host.planning,effects:f.effects()};
 });
 expect(result.receipt.status).toBe('conflict');expect(result.blocked).toBe(true);expect(result.source[0].transferredTo).toBeUndefined();expect(result.target[0].title).toBe('Existing');expect(result.effects).toBe(0);
});
test('revocation while the planning lock is held is checked again before the atomic adoption',async({page})=>{
 const result=await page.evaluate(async()=>{
  const f=(window as any).fixture;let release:any,entered:any;const ready=new Promise(resolve=>entered=resolve);
  const lock=navigator.locks.request('sd-planning:'+f.target.record.workspace,()=>new Promise(resolve=>{release=resolve;entered();}));await ready;
  const operation=f.makeSync()({},{workspace:'device:phone',edit:{id:'transfer_revoked',key:'planningTransfer/'+f.item.id,base:null,value:f.item}});
  f.revoke();release();await lock;let blocked=false;try{await operation;}catch{blocked=true;}
  await f.target.reload();return {blocked,items:f.target.view().data.host.planning,receipt:f.target.record.drafts.executorEdits,effects:f.effects()};
 });
 expect(result.blocked).toBe(true);expect(result.items).toEqual([]);expect(result.receipt).toBeUndefined();expect(result.effects).toBe(0);
});

test('the transfer editor persists a lost activation response and resumes it from IndexedDB without a second publisher',async({page})=>{
 await page.evaluate(async()=>{
  const f=(window as any).fixture;await f.source.commitPlanning([f.item]);
  document.body.innerHTML='<div id="handoff-root"></div>';
  const {createPlanningHandoffUI}=await import('/mobile/control/planning-handoff-ui.js' as string);
  const devices=[{id:'source',name:'PC',workspace:'device:pc'},{id:'target',name:'Android',workspace:'device:phone'}];let lost=false;
  const ui=createPlanningHandoffUI({devices:async()=>devices,store:async()=>f.source,esc:(text:string)=>String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),modal:(html:string)=>document.querySelector('#handoff-root')!.innerHTML=html,changed:()=>{},
   snapshot:async(d:any)=>{const store=d.id==='source'?f.source:f.target;await store.reload();return {workspace:d.workspace,bundle:store.view()};},
   call:async(d:any,body:any)=>{const planning=d.id==='source'?f.sourcePlanning:f.planning;const receipt=await planning.handoff(body.workspace,body.operation,body.ticket,body.proof,()=>{});if(body.operation==='activate'&&!lost){lost=true;throw Error('Réponse perdue');}return {receipt};},
  });
  document.addEventListener('submit',e=>{e.preventDefault();void ui.submit(e.target).catch((error:any)=>{(window as any).uiError=error.message;});});
  document.addEventListener('click',e=>{const b=(e.target as HTMLElement).closest('[data-task]') as HTMLElement;if(b)void ui.task(b.dataset.task,b).catch((error:any)=>{(window as any).uiError=error.message;});});
  await ui.task('planning-handoff');
 });
 await page.getByRole('button',{name:'Lire les événements'}).click();
 await page.getByRole('button',{name:'Prévisualiser le transfert'}).click();
 expect(await page.evaluate(()=>(window as any).fixture.source.view().data.host.planning[0].transferredTo)).toBeUndefined();
 await page.getByRole('button',{name:'Déplacer cet événement'}).click();
 await expect(page.locator('#handoff-root')).toContainText('Réponse perdue');
 await page.getByRole('button',{name:'Reprendre',exact:true}).click();
 await expect(page.locator('#handoff-root')).toContainText('Terminé');
 const result=await page.evaluate(async()=>{const f=(window as any).fixture;await f.source.reload();await f.target.reload();let blocked=false;try{await f.source.commitPlanning([]);}catch{blocked=true;}return {source:f.source.view().data.host.planning,target:f.target.view().data.host.planning,effects:f.effects(),jobs:f.source.record.drafts.planningHandoffJobs,blocked};});
 expect(result.source[0].transferredTo).toBe('device:phone');expect(result.target).toHaveLength(1);expect(result.target[0].providers.google.remoteId).toBe('event-1');expect(result.effects).toBe(0);expect(result.blocked).toBe(true);expect((Object.values(result.jobs)[0] as any).status).toBe('completed');
});

test('two controllers cannot freeze the same local event for different destinations',async({page})=>{
 const result=await page.evaluate(async()=>{
  const f=(window as any).fixture;await f.source.commitPlanning([f.item]);
  const first={id:'handoff_controller_one',from:'device:pc',to:'device:phone',item:f.item};
  const second={...first,id:'handoff_controller_two',to:'device:other'};
  const responses=await Promise.allSettled([f.sourcePlanning.handoff('device:pc','prepare',first,undefined,()=>{}),f.sourcePlanning.handoff('device:pc','prepare',second,undefined,()=>{})]);
  await f.source.reload();return {states:responses.map(x=>x.status),source:f.source.view().data.host.planning,effects:f.effects()};
 });
 expect(result.states.sort()).toEqual(['fulfilled','rejected']);expect(result.source[0].transferId).toBe('handoff_controller_one');expect(result.effects).toBe(0);
});
