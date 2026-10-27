import {test,expect} from '@playwright/test';
import express from 'express';
import path from 'node:path';
import type {Server} from 'node:http';
let server:Server,origin:string;
test.beforeAll(async()=>{const app=express();app.use('/mobile',express.static(path.resolve('apps/mobile')));app.get('/',(_req,res)=>res.send('<!doctype html><title>Configuration transfer</title>'));server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});origin='http://127.0.0.1:'+(server.address() as {port:number}).port;});
test.afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});
test.beforeEach(async({page})=>{await page.goto(origin);});
test('Android persists copied configuration and receipt atomically; reopening, lost replies and undo preserve identities',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {openReplica}=await import('/mobile/control/autonomy-store.js' as string),{newWorkspace}=await import('/mobile/control/device-workspace.js' as string),{createExecutorSync}=await import('/mobile/control/executor-sync.js' as string),{configurationTransferSupport,planConfigurationCopy,runConfigurationCopy}=await import('/mobile/shared/configuration-transfer.js' as string);
  const a=await openReplica('source'),b=await openReplica('target');await a.seed(newWorkspace({name:'Source'}));await b.seed(newWorkspace({name:'Target'}));
  const button={id:'new-button',type:'sound.stop',value:'',label:'Arrêter',color:'red',shortcut:'Control+Alt+Shift+F8'};await a.stage({'action/new-button':button,'settings/root':{...a.view().data.host.settings,streamerName:'Copié'}});
  const snapshots:any={a:()=>({workspace:a.record.workspace,bundle:a.view()}),b:()=>({workspace:b.record.workspace,bundle:b.view(),configurationTransfer:configurationTransferSupport('android')})};
  let sync=createExecutorSync({runtime:async()=>({owner:{store:b}}),workspace:()=>b.record.workspace,authorize(){},requireRole(){throw Error('unexpected');}}),job:any={id:'copy_android_fixture',source:'a',target:'b',...planConfigurationCopy(snapshots.a(),snapshots.b())},lost=true;
  const options={snapshot:async(id:string)=>{await a.reload();await b.reload();return snapshots[id]();},save:async(next:any)=>{job=structuredClone(next);await a.draft('copy',job);},apply:async(_id:string,body:any)=>{const receipt=await sync({},body);if(lost){lost=false;throw Error('lost response');}return {workspace:b.record.workspace,receipt};}};
  let interrupted=false;try{await runConfigurationCopy(job,options);}catch{interrupted=true;}
  const reopened=await openReplica('target');sync=createExecutorSync({runtime:async()=>({owner:{store:reopened}}),workspace:()=>reopened.record.workspace,authorize(){},requireRole(){}});
  await a.reload();await runConfigurationCopy(a.record.drafts.copy,options);await b.reload();const copied=b.view();
  const pending=b.record.pending.length;await runConfigurationCopy(job,options);await b.reload();const duplicate=b.record.pending.length;
  await runConfigurationCopy(job,options,true);await b.reload();return {interrupted,pending,duplicate,copied,after:b.view(),job};
 });
 expect(result.interrupted).toBe(true);expect(result.duplicate).toBe(result.pending);expect(result.copied.data.configuration.actions.find((x:any)=>x.id==='new-button')).toMatchObject({shortcut:'Control+Alt+Shift+F8',label:'Arrêter'});expect(result.copied.data.host.settings.streamerName).toBe('Copié');expect(result.after.data.host.settings.streamerName).toBe('Streamer');expect(result.after.data.configuration.actions.some((x:any)=>x.id==='new-button')).toBe(false);expect(result.job.status).toBe('rolled-back');
});
test('actual Android executor requires full permission and strict comparison, with status reads that never write',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {openReplica}=await import('/mobile/control/autonomy-store.js' as string),{newWorkspace}=await import('/mobile/control/device-workspace.js' as string),{createDeviceExecutor}=await import('/mobile/control/device-executor.js' as string),{migrateInstallation}=await import('/mobile/shared/installation.js' as string),{DEVICE_PERMISSIONS}=await import('/mobile/shared/device-permissions.js' as string);
  const store=await openReplica('phone');await store.seed(newWorkspace({name:'Phone'}));let enabled=false;
  const executor=await createDeviceExecutor({bridge:{call:async(op:string)=>{if(op==='load')return null;if(op==='start')enabled=true;return {enabled,urls:[]};},listen(){}},installation:()=>migrateInstallation({id:'phone',platform:'android'}),runtime:async()=>({owner:{store},audio:{snapshot:()=>store.view().sounds}})});
  await executor.localRequest('/api/v2/settings',{expectedRevision:'0',remoteEnabled:true},'PUT');
  const pair=async(permissions:string[])=>{const code=await executor.localRequest('/api/v1/remote/pairing',{permissions},'POST');return (await executor.handle({path:'/api/v1/remote/pair',method:'POST',body:JSON.stringify({id:code.id,code:code.code}),remote:'fixture'})).body;};
  const limited=await pair(['observe']),full=await pair(Object.keys(DEVICE_PERMISSIONS));
  const edit={id:'android_strict_fixture',key:'preferences/root',base:{replayAutoStart:true},value:{replayAutoStart:false},strict:true};
  const request=(credential:string,body:any)=>executor.handle({path:'/api/v2/autonomy/sync',method:'POST',body:JSON.stringify(body),authorization:'Device '+credential});
  const absent=await request(full.credential,{workspace:'device:phone',edit,statusOnly:true}),denied=await request(limited.credential,{workspace:'device:phone',edit});
  await store.stage({'preferences/root':{replayAutoStart:false}});
  const conflict=await request(full.credential,{workspace:'device:phone',edit});
  const next={...edit,id:'android_strict_new',base:{replayAutoStart:false},value:{replayAutoStart:true}};
  const applied=await request(full.credential,{workspace:'device:phone',edit:next});
  await executor.localRequest('/api/v1/remote/devices/'+full.deviceId+'/revoke',{},'POST');
  const revoked=await request(full.credential,{workspace:'device:phone',edit:next,statusOnly:true});
  await store.reload();return {absent:absent.body.receipt.status,denied:denied.status,conflict:conflict.body.receipt.status,applied:applied.body.receipt.status,revoked:revoked.status,value:store.view().data.configuration.replayAutoStart};
 });
 expect(result).toEqual({absent:'absent',denied:403,conflict:'conflict',applied:'applied',revoked:401,value:true});
});
test('interface previews selected values, retains an interrupted copy and confirms rollback',async({page})=>{
 await page.evaluate(async()=>{
  const {openReplica}=await import('/mobile/control/autonomy-store.js' as string),{newWorkspace}=await import('/mobile/control/device-workspace.js' as string),{createConfigurationTransferUI}=await import('/mobile/control/configuration-transfer-ui.js' as string),{configurationTransferSupport}=await import('/mobile/shared/configuration-transfer.js' as string),{createExecutorSync}=await import('/mobile/control/executor-sync.js' as string);
  const a=await openReplica('a'),b=await openReplica('b');await a.seed(newWorkspace({name:'Source'}));await b.seed(newWorkspace({name:'Target'}));await a.stage({'preferences/root':{replayAutoStart:false}});
  const sync=createExecutorSync({runtime:async()=>({owner:{store:b}}),workspace:()=>b.record.workspace,authorize(){},requireRole(){}});let lost=true;
  const ui=createConfigurationTransferUI({devices:async()=>[{id:'a',name:'PC'},{id:'b',name:'Android'}],snapshot:async(d:any)=>{const store=d.id==='a'?a:b;await store.reload();return {workspace:store.record.workspace,bundle:store.view(),configurationTransfer:configurationTransferSupport('android')};},store:async()=>a,modal:(html:string)=>{document.body.innerHTML=html;},esc:(v:any)=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),changed:async()=>{},apply:async(_d:any,body:any)=>{const receipt=await sync({},body);if(lost){lost=false;throw Error('Réponse interrompue');}return {workspace:b.record.workspace,receipt};}});
  document.addEventListener('submit',event=>{event.preventDefault();void ui.submit(event.target).catch(()=>{});});document.addEventListener('click',event=>{const button=(event.target as HTMLElement).closest('button[data-task]') as HTMLElement;if(button)void ui.task(button.dataset.task,button).catch(()=>{});});await ui.task('configuration-copy');
 });
 await page.getByRole('button',{name:'Comparer les configurations'}).click();await expect(page.getByRole('heading',{name:'Choisir les configurations à copier'})).toBeVisible();
 await page.getByRole('button',{name:'Copier les réglages sélectionnés'}).click();await expect(page.getByText('Réponse interrompue')).toBeVisible();
 await page.getByRole('button',{name:'Reprendre la copie'}).click();await expect(page.getByText('1 / 1 réglages copiés · Terminé')).toBeVisible();
 await page.getByRole('button',{name:'Revenir à la configuration précédente'}).click();await page.getByRole('button',{name:'Confirmer le retour arrière'}).click();await expect(page.getByText('0 / 1 réglages copiés · Ancienne configuration restaurée')).toBeVisible();
});
