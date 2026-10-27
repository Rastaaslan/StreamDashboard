import {test,expect} from '@playwright/test';
import express from 'express';
import path from 'node:path';
import type {Server} from 'node:http';
let server:Server,origin:string;
test.beforeAll(async()=>{const app=express();app.use('/mobile',express.static(path.resolve('apps/mobile')));app.get('/',(_req,res)=>res.send('<!doctype html><title>Setup migration</title>'));server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});origin='http://127.0.0.1:'+(server.address() as {port:number}).port;});
test.afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});

async function initialize(){
 const {openReplica}=await import('/mobile/control/autonomy-store.js' as string),{newWorkspace}=await import('/mobile/control/device-workspace.js' as string),{createLocalPlanning}=await import('/mobile/control/local-planning.js' as string),{createExecutorSync}=await import('/mobile/control/executor-sync.js' as string),{createLocalSoundLibrary,uploadLocalSound}=await import('/mobile/control/local-sound-library.js' as string),{configurationTransferSupport}=await import('/mobile/shared/configuration-transfer.js' as string),{migrateInstallation,createInstallationStore}=await import('/mobile/shared/installation.js' as string),{planSetupMigration,runSetupMigration}=await import('/mobile/control/setup-migration.js' as string),{createSetupMigrationUI}=await import('/mobile/control/setup-migration-ui.js' as string);
 const a=await openReplica('migration-source'),b=await openReplica('migration-target');
 if(!a.view()){
  await a.seed(newWorkspace({name:'PC'}));await b.seed(newWorkspace({name:'Android'}));
  await a.stage({'preferences/root':{replayAutoStart:false},'action/migration_stop':{id:'migration_stop',type:'sound.stop',value:'',label:'Arrêter',shortcut:'',color:'red'}});
  await a.addSound(new File([Uint8Array.from({length:71000},(_,i)=>i%255)],'été.wav'),'Ambiance');
  await a.commitPlanning([{id:'event_migrate',title:'Prévu',category:'live',ownership:'LOCAL',editable:true,startAtUtc:'2030-11-01T18:00:00Z',endAtUtc:'2030-11-01T19:00:00Z',providers:{google:{status:'synced',remoteId:'preserved-event-id',calendarId:'preserved-calendar'}}}]);
 }
 const first=migrateInstallation({id:'source_device',platform:'windows',legacy:{configured:true}}),destination=migrateInstallation({id:'target_device',platform:'android'}).devices[0];first.devices.push({...destination,endpoint:'https://target.test'});
 const topology=createInstallationStore(localStorage,()=>first);
 const devices=[{id:'a',deviceId:'source_device',scope:'migration-source',name:'PC'},{id:'b',deviceId:'target_device',scope:'migration-target',name:'Android'}],stores:any={a,b};
 let effects=0,lost=false,allow=true;const providers={adapters:new Proxy({},{get(){effects++;throw Error('Unexpected publication');}})},planning:any={a:createLocalPlanning({store:a,providers}),b:createLocalPlanning({store:b,providers})};
 const sync=createExecutorSync({runtime:async()=>({owner:{store:b}}),workspace:()=>b.record.workspace,authorize(){},requireRole(){}}),read=createLocalSoundLibrary(a);
 const adapter={
  snapshot:async(d:any)=>{const value=stores[d.id];await value.reload();return {workspace:value.record.workspace,bundle:value.view(),configurationTransfer:configurationTransferSupport('android')};},
  installation:async()=>topology.read(),changeInstallation:(changes:any,revision:number)=>topology.change(changes,revision),
  preflight:async()=>{if(!allow)throw Error('Appareil déconnecté');},
  descriptor:async()=>({device:destination}),
  apply:async(_d:any,body:any)=>({workspace:b.record.workspace,receipt:await sync({},body)}),
  handoff:async(d:any,body:any)=>{const receipt=await planning[d.id].handoff(body.workspace,body.operation,body.ticket,body.proof,()=>{});if(body.operation==='activate'&&lost){lost=false;throw Error('Confirmation interrompue');}return {receipt};},
  read:async(_d:any,body:any)=>read(body,'test'),upload:async(_d:any,input:any)=>uploadLocalSound(b,input,destination,b.record.workspace),
  save:async(job:any)=>a.updateDraft('setupMigrations',(jobs:any)=>({...jobs,[job.id]:structuredClone(job)})),
 };
 const ui=createSetupMigrationUI({...adapter,devices:async()=>devices,store:async()=>a,esc:(v:any)=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),modal:(html:string)=>{document.body.innerHTML=html;},changed:async()=>{}});
 document.addEventListener('submit',event=>{event.preventDefault();void ui.submit(event.target).catch((error:any)=>{(window as any).lastError=error.message;});});
 document.addEventListener('click',event=>{const button=(event.target as HTMLElement).closest('[data-task]') as HTMLElement;if(button)void ui.task(button.dataset.task,button).catch((error:any)=>{(window as any).lastError=error.message;});});
 (window as any).fixture={a,b,adapter,devices,topology,planSetupMigration,runSetupMigration,ui,effects:()=>effects,lose:()=>{lost=true;},allow:(v:boolean)=>{allow=v;}};
 await ui.task('setup-migration');
}

test('full wizard survives a real page reload after lost activation and reverses current planning without deleting audio',async({page})=>{
 await page.goto(origin);await page.evaluate(initialize);
 await page.getByRole('button',{name:'Préparer le changement',exact:true}).click();
 await page.getByRole('button',{name:'Vérifier le basculement'}).click();
 await expect(page.getByRole('heading',{name:'Confirmer le changement d’installation'})).toBeVisible();
 await page.evaluate(()=>(window as any).fixture.lose());
 await page.getByRole('button',{name:'Appliquer ce changement'}).click();
 await expect(page.getByText('Confirmation interrompue', {exact:true})).toBeVisible();
 const before=await page.evaluate(async()=>{const f=(window as any).fixture;await f.a.reload();return {job:Object.values(f.a.record.drafts.setupMigrations)[0],routes:f.topology.read().actionRoutes};});
 expect((before.job as any).routing.attempted).toBeUndefined();expect(before.routes).toBeUndefined();
 await page.reload();await page.evaluate(initialize);
 await page.getByRole('button',{name:'Reprendre le changement'}).click();await expect(page.getByText('Terminé',{exact:true})).toBeVisible();
 const copied=await page.evaluate(async()=>{const f=(window as any).fixture;await f.a.reload();await f.b.reload();const items=f.b.view().data.host.planning;items[0].title='Modifié sur Android';await f.b.commitPlanning(items);return {source:f.a.view(),target:f.b.view(),routes:f.topology.read().actionRoutes,effects:f.effects()};});
 expect(copied.source.data.host.planning[0].editable).toBe(false);expect(copied.target.data.host.planning[0].providers.google.remoteId).toBe('preserved-event-id');expect(copied.routes.find((r:any)=>r.actionId==='migration_stop').deviceId).toBe('target_device');expect(copied.effects).toBe(0);
 await page.getByRole('button',{name:'Préparer le retour arrière'}).click();await page.getByRole('button',{name:'Confirmer le retour arrière'}).click();await expect(page.getByText('Retour arrière terminé',{exact:true})).toBeVisible();
 const result=await page.evaluate(async()=>{const f=(window as any).fixture;await f.a.reload();await f.b.reload();return {source:f.a.view(),target:f.b.view(),routes:f.topology.read().actionRoutes,effects:f.effects(),audioSize:(await f.b.soundAsset(f.b.view().sounds.sounds[0].id)).size};});
 expect(result.source.data.host.planning[0].title).toBe('Modifié sur Android');expect(result.source.data.host.planning[0].editable).toBe(true);expect(result.target.data.host.planning[0].editable).toBe(false);expect(result.target.data.configuration.replayAutoStart).toBe(true);expect(result.routes).toEqual([]);expect(result.audioSize).toBe(71000);expect(result.effects).toBe(0);
});

test('a second controller cannot migrate the same planning item to another device',async({page})=>{
 await page.goto(origin);await page.evaluate(initialize);
 const result=await page.evaluate(async()=>{
  const f=(window as any).fixture,from=await f.adapter.snapshot(f.devices[0]),to=await f.adapter.snapshot(f.devices[1]);
  const job=f.planSetupMigration({id:'parallel_setup_one',source:f.devices[0],target:f.devices[1],from,to,installation:await f.adapter.installation(),descriptor:await f.adapter.descriptor(),configuration:false,routeActions:false,sounds:[],planningIds:['event_migrate']});
  const second={...structuredClone(job),id:'parallel_setup_two',planning:job.planning.map((j:any)=>({...j,ticket:{...j.ticket,id:'second_controller_ticket'}}))};
  const states=await Promise.allSettled([f.runSetupMigration(job,{...f.adapter,save:async()=>{}}),f.runSetupMigration(second,{...f.adapter,save:async()=>{}})]);
  await f.a.reload();await f.b.reload();return {states:states.map(x=>x.status).sort(),source:f.a.view().data.host.planning,target:f.b.view().data.host.planning,effects:f.effects()};
 });
 expect(result.states).toEqual(['fulfilled','rejected']);expect(result.source[0].editable).toBe(false);expect(result.target).toHaveLength(1);expect(result.target[0].providers.google.remoteId).toBe('preserved-event-id');expect(result.effects).toBe(0);
});
