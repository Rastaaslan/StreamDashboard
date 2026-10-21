import {test,expect} from '@playwright/test';
import express from 'express';
import path from 'node:path';
import type {Server} from 'node:http';
let server:Server,origin:string;
test.beforeAll(async()=>{
 const app=express();app.use('/mobile',express.static(path.resolve('apps/mobile')));
 app.get('/',(_req,res)=>res.send('<!doctype html><meta charset="utf-8"><div id="root"></div>'));
 server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
 origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
test.afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
for(const preset of ['single-pc','single-pc-deck','dual-pc','dual-pc-deck','android-only','custom']){
 test(preset+': same setup editor previews, commits and restores without deleting other data',async({page})=>{
  await page.goto(origin);
  await page.evaluate(async preset=>{
   const win=window as any,modelPath='/mobile/shared/installation.js',uiPath='/mobile/control/installation-ui.js';
   const model=await import(modelPath),ui=await import(uiPath);
   const android=preset==='android-only';
   let state=model.migrateInstallation({id:'local',platform:android?'android':'windows',legacy:{role:android?'mobile':'control',name:'Before'}}),backup:any;
   localStorage.setItem('preserved-planning','unchanged');
   const desktop=android?undefined:{getInstallation:async()=>structuredClone(state),changeInstallation:async(changes:any,revision:number)=>{const result=model.planInstallationChange(state,changes,revision);backup=state;state=result.next;return result;},restoreInstallation:async()=>{const next={...backup,revision:state.revision+1};backup=state;state=next;return {next,restart:false};}};
   win.ui=await ui.createInstallationUI({device:{name:'Before',role:android?'mobile':'control'},native:android,desktop,modal:(html:string)=>{document.querySelector('#root')!.innerHTML=html;},esc:(s:string)=>String(s),changed:(value:any)=>{win.saved=value;},select:async()=>{}});
   document.addEventListener('submit',event=>{event.preventDefault();void win.ui.submit(event.target);});
   document.addEventListener('click',event=>{const b=(event.target as Element).closest<HTMLButtonElement>('[data-task]');if(b)void win.ui.task(b.dataset.task,b);});
   win.ui.open();
  },preset);
  await expect(page.locator('[name=preset] option')).toHaveCount(6);
  await page.locator('[name=preset]').selectOption(preset);await page.locator('[name=name]').fill('After');
  await page.getByRole('button',{name:'Prévisualiser le changement'}).click();
  expect(await page.evaluate(()=>(window as any).saved)).toBeUndefined();
  await page.getByRole('button',{name:'Appliquer',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).saved?.preset)).toBe(preset);
  expect(await page.evaluate(()=>localStorage.getItem('preserved-planning'))).toBe('unchanged');
  await page.evaluate(()=>(window as any).ui.open());page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Restaurer la configuration précédente'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).saved?.revision)).toBe(2);
  expect(await page.evaluate(()=>(window as any).saved.devices[0].name)).toBe('Before');
 });
}
test('Android uses the same monitor with independent Twitch and YouTube targets without a PC',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('https://**/*',route=>route.abort());await page.goto(origin);
 await page.evaluate(async()=>{
  localStorage.setItem('sd2.monitor-enabled','true');
  const win=window as any;win.nativeViewerCalls=[];win.StreamDashboardNative={openViewers:(payload:string)=>{win.nativeViewerCalls.push(JSON.parse(payload));return true;}};
  const modulePath='/mobile/control/live-monitor.js';const {createLiveMonitor}=await import(modulePath);
  const monitor=createLiveMonitor(document.querySelector('#root'),{native:true});
  monitor.update({configuration:{youtube:{}},host:{}},{online:true,sourceKey:'device'});
 });
 await page.locator('.monitor-targets summary').click();
 await page.locator('[name=channel]').fill('test_channel');await page.locator('[name=video]').fill('Abc_1234-XY');
 await page.getByRole('button',{name:'Enregistrer ces retours'}).click();
 await expect(page.locator('iframe')).toHaveCount(0);
 await page.getByRole('button',{name:'Ouvrir vidéo et chats',exact:true}).first().click();
 expect(await page.evaluate(()=>(window as any).nativeViewerCalls)).toEqual([{twitch:'test_channel',youtube:'Abc_1234-XY',source:'twitch'}]);
 await expect(page.locator('[data-monitor-link="twitch"]')).toHaveAttribute('href',/test_channel/);
 await page.getByRole('button',{name:'YouTube',exact:true}).click();
 await expect(page.locator('[data-monitor-viewer-status]')).toContainText('non vérifiable');
 await expect(page.locator('[data-monitor-link="youtube"]')).toHaveAttribute('href',/Abc_1234-XY/);
});

test('a destination selected on the phone stays executable when its active workspace is offline',async({page})=>{
 await page.goto(origin);
 await page.evaluate(async()=>{
  const win=window as any,model=await import('/mobile/shared/installation.js' as string),ui=await import('/mobile/control/action-routing-ui.js' as string),routing=await import('/mobile/control/action-routing.js' as string),performance=await import('/mobile/control/performance-ui.js' as string);
  let installation=model.migrateInstallation({id:'phone',platform:'android'});
  installation.devices.push({id:'executor',name:'Atelier',platform:'windows',enabled:true,roles:['obs-executor'],capabilities:['obs'],endpoint:'http://executor.local:48133'});
  const action={id:'local-button',label:'Ma scène',type:'scene.set',value:'intro',color:'purple',shortcut:''},definition={...action,id:'remote-button'};
  const router=routing.createActionRouter({installation:()=>installation,workspace:()=> 'phone',localEndpoint:'',credential:async()=> 'synthetic-token',request:async(path:string)=>path.endsWith('/device')?{device:{id:'executor'}}:{configuration:{actions:[definition]},host:{state:{obs:{connected:true}}}}});
  const installationUI={get current(){return installation;},reload:async()=>installation,apply:async(changes:any)=>{installation=model.planInstallationChange(installation,changes,installation.revision).next;}};
  win.routeUI=ui.createActionRoutingUI({installationUI,router,workspace:()=> 'phone',actions:()=>[action],localEndpoint:'',modal:(html:string)=>document.querySelector('#root')!.innerHTML=html,esc:String,changed:()=>{win.bound=installation.actionRoutes;document.querySelector('#root')!.innerHTML=performance.renderPerformancePage({data:{configuration:{actions:[action]},host:{state:{obs:{connected:false}}}},online:false,local:true,routedStatus:(a:any)=>router.status(a),favorites:['action:local-button'],mode:'deck',bank:'favorites',esc:String});}});
  document.addEventListener('submit',event=>{event.preventDefault();void win.routeUI.submit(event.target);});
  await win.routeUI.task('action-route',{dataset:{actionId:action.id}});
 });
 await page.getByRole('button',{name:'Lire les boutons de cet appareil'}).click();
 await page.getByRole('button',{name:'Enregistrer cette destination'}).click();
 await expect(page.locator('[data-action="local-button"]').first()).toBeEnabled();
 await expect(page.locator('[data-action="local-button"]').first()).toContainText('Atelier');
 expect(await page.evaluate(()=>(window as any).bound[0].definition.id)).toBe('remote-button');
});

test('Android reads the owner chat independently of OBS and renders message text safely',async({page})=>{
 await page.goto(origin);
 await page.evaluate(async()=>{
  const path='/mobile/control/youtube-chat.js',module=await import(path),win=window as any;
  win.chatCalls=[];
  const bridge={youtubeStatus:()=>JSON.stringify({ok:true,connected:true,account:'phone-account'}),youtubeChatBroadcast:(raw:string)=>{win.chatCalls.push(JSON.parse(raw));return JSON.stringify({ok:true,id:'ABCDEFGHIJK',channelId:'owner-channel',account:'My channel',broadcastState:'ready',liveChatId:'chat-for-selected-video'});},youtubeChatMessages:(raw:string)=>{win.chatCalls.push(JSON.parse(raw));return JSON.stringify({ok:true,items:[{id:'one',snippet:{displayMessage:'<img src=x onerror=alert(1)>'},authorDetails:{displayName:'Viewer'}}],pollingIntervalMillis:20000,nextPageToken:'next'});}};
  win.chat=module.createYouTubeChat(document.querySelector('#root'),{native:true,bridge});
  win.chat.update({enabled:true,broadcastId:'ABCDEFGHIJK',sourceKey:'phone'});
 });
 await expect(page.getByRole('status')).toContainText('Diffusion préparée. Chat connecté.');
 await expect(page.locator('[data-youtube-account]')).toContainText('My channel');
 await expect(page.getByRole('log')).toContainText('<img src=x onerror=alert(1)>');
 await expect(page.locator('img')).toHaveCount(0);
 const calls=await page.evaluate(()=>(window as any).chatCalls);expect(calls).toEqual([{broadcastId:'ABCDEFGHIJK'},{liveChatId:'chat-for-selected-video',pageToken:''}]);
});

test('Android executor synchronizes with durable receipts and preserves concurrent local edits in real IndexedDB',async({page})=>{
 await page.goto(origin);
 const result=await page.evaluate(async()=>{
  const {openReplica}=await import('/mobile/control/autonomy-store.js' as string),{newWorkspace}=await import('/mobile/control/device-workspace.js' as string),{createDeviceExecutor}=await import('/mobile/control/device-executor.js' as string),{migrateInstallation}=await import('/mobile/shared/installation.js' as string),{DEVICE_PERMISSIONS}=await import('/mobile/shared/device-permissions.js' as string);
  let config:any,enabled=false,store=await openReplica('executor-test');await store.seed(newWorkspace({name:'Phone'}));
  // Android serves trusted assets over its historical HTTP origin: SubtleCrypto is not available.
  Object.defineProperty(crypto,'subtle',{value:undefined,configurable:true});
  const installation=migrateInstallation({id:'phone',platform:'android'}),bridge={listen(){},async call(op:string,value:any){if(op==='load')return config;if(op==='save'){config=value.value;return true;}if(op==='start')enabled=true;if(op==='stop')enabled=false;return {enabled,urls:['https://phone.local:48136'],fingerprint:'a'.repeat(64)};}};
  const runtime=()=>Promise.resolve({owner:{store},audio:{snapshot:()=>({sounds:[],available:true})}});
  let executor=await createDeviceExecutor({bridge,installation:()=>installation,runtime});await executor.localRequest('/api/v2/settings',{expectedRevision:'0',remoteEnabled:true},'PUT');
  const pair=await executor.localRequest('/api/v1/remote/pairing',{permissions:Object.keys(DEVICE_PERMISSIONS)},'POST');
  const paired=await executor.handle({path:'/api/v1/remote/pair',method:'POST',body:JSON.stringify({id:pair.id,code:pair.code,name:'PC'}),remote:'test'});
  const invoke=(edit:any)=>executor.handle({path:'/api/v2/autonomy/sync',method:'POST',authorization:'Device '+paired.body.credential,body:JSON.stringify({workspace:'device:phone',edit}),remote:'test'});
  const action={id:'jingle',type:'sound.play',value:'audio',label:'First',color:'green',shortcut:''},edit={id:'edit_000001',key:'action/jingle',base:null,value:action};
  const first=await invoke(edit);const pending=store.record.pending.length;
  store.close();store=await openReplica('executor-test');executor=await createDeviceExecutor({bridge,installation:()=>installation,runtime});
  const replay=await invoke(edit),replayedPending=store.record.pending.length;
  const other=await openReplica('executor-test');await other.stage({'action/jingle':{...action,label:'Changed on Android'}});
  const conflict=await invoke({...edit,id:'edit_000002',base:action,value:{...action,label:'Changed on PC'}});
  let guarded=false;try{await store.stage({'action/jingle':{...action,label:'Overwrite'}},{'action/jingle':action},true);}catch{guarded=true;}
  await store.reload();const label=store.view().data.configuration.actions.find((a:any)=>a.id==='jingle').label;
  const secret=await invoke({...edit,id:'edit_000003',value:{...action,credential:'must-not-save'}});
  const reused=await invoke({...edit,value:{...action,label:'Reused'}});
  other.close();store.close();return {first:first.body.receipt.status,replay:replay.body.receipt.status,pending,replayedPending,conflict:conflict.body.receipt.status,guarded,label,secret:secret.status,reused:reused.status};
 });
 expect(result).toEqual({first:'applied',replay:'applied',pending:1,replayedPending:1,conflict:'conflict',guarded:true,label:'Changed on Android',secret:400,reused:400});
});
