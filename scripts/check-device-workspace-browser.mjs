import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir,networkInterfaces} from 'node:os';
import path from 'node:path';
import express from 'express';
import {chromium,expect} from '@playwright/test';
import {startDashboardServer} from '../dist/apps/server/src/index.js';

const dir=await mkdtemp(path.join(tmpdir(),'sd-device-workspace-'));
const assets=express();assets.use(express.static(path.resolve('apps/mobile')));
const assetServer=assets.listen(48134,'127.0.0.1');await new Promise(r=>assetServer.once('listening',r));
let context,host;const errors=[];
const mocks=()=>{
  let credential='';const status=p=>JSON.stringify({ok:true,configured:true,connected:localStorage.getItem('mock.'+p)==='yes',calendarAuthorized:true,youtubeAuthorized:localStorage.getItem('mock.youtube')==='yes'});
  globalThis.StreamDashboardNative={isAndroid:()=>true,getCredential:()=>credential,setCredential:v=>{credential=v;},clearCredential:()=>{credential='';},setKeepAwake(){}};
  globalThis.StreamDashboardProviders={
    twitchStatus:()=>status('twitch'),googleStatus:()=>status('google'),
    twitchAuthorize:()=>{localStorage.setItem('mock.twitch','yes');return JSON.stringify({ok:true,user_code:'EXAMPLE',verification_uri:'https://www.twitch.tv/activate'});},
    googleAuthorize:()=>{localStorage.setItem('mock.google','yes');return '{"ok":true}';},
    youtubeAuthorize:()=>{localStorage.setItem('mock.youtube','yes');return '{"ok":true}';},
    twitchTest:()=>JSON.stringify({ok:true,tested:true,connected:true,account:'Compte de test',capabilities:['schedule']}),
    googleTest:()=>JSON.stringify({ok:true,tested:true,connected:true,capabilities:['calendar']}),
    googleCalendars:()=>JSON.stringify({ok:true,items:[{id:'test-calendar',accessRole:'owner',primary:true}]}),
  };
  for(const provider of ['twitch','google'])for(const verb of ['Create','Update','Delete'])globalThis.StreamDashboardProviders[provider+verb+'Planning']=raw=>{
   const input=JSON.parse(raw),key='mock.'+provider+'.'+verb;localStorage.setItem(key,String(Number(localStorage.getItem(key)||0)+1));
   if(provider==='google'&&localStorage.getItem('mock.rejectGoogle')==='yes')return JSON.stringify({ok:false,code:'HTTP_403',message:'Refus simulé',nonCreation:true});
   return JSON.stringify({ok:true,remoteId:input.link.remoteId||provider+'-'+input.event.id,calendarId:input.link.calendarId,revision:'v1',fingerprint:'fp'});
  };
  globalThis.StreamDashboardProviders.requestAsync=raw=>{const request=JSON.parse(raw);setTimeout(()=>{let result;try{result=globalThis.StreamDashboardProviders[request.method](JSON.stringify(request.payload));}catch(e){result=JSON.stringify({ok:false,message:e.message});}dispatchEvent(new CustomEvent('provider-result',{detail:{id:request.id,result}}));},5);return '{"ok":true}';};
};
try{
 context=await chromium.launchPersistentContext(path.join(dir,'browser'),{headless:true,viewport:{width:412,height:915}});
 await context.addInitScript(mocks);let page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:48134/control/');
 await expect(page.locator('#device-setup-form')).toBeVisible();
 await page.locator('#device-setup-form [name=name]').fill('Téléphone de test');await page.locator('#device-setup-form button').click();
 await expect(page.locator('#connection')).toContainText('Espace de cet appareil');
 assert.ok(await page.evaluate(()=>{const h=document.querySelector('header');return h.scrollHeight<=h.clientHeight&&document.documentElement.scrollWidth<=innerWidth;}),'Mobile header fits device name and account controls');
 await page.locator('[data-page=manage]').first().click();await page.locator('[data-page=planning]').last().click();
 await page.locator('[data-planning=new]').click();await page.locator('#planning-event-form [name=title]').fill('Créé avant le premier PC');
 await page.locator('#planning-event-form button:not([type])').click();await expect(page.locator('#dialog')).not.toBeVisible();
 const read=scope=>page.evaluate(async scope=>{const {openReplica}=await import('/control/autonomy-store.js');const s=await openReplica(scope);const r=s.record;s.close();return r;},scope);
 const before=await read('device-workspace-v1');assert.equal(before.pending.length,1);const id=before.pending[0].key.slice(9);
 // Full browser restart, with NO host process running.
 await context.close();context=await chromium.launchPersistentContext(path.join(dir,'browser'),{headless:true,viewport:{width:412,height:915}});await context.addInitScript(mocks);
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:48134/control/');
 await expect(page.locator('#device-setup-form')).toHaveCount(0);assert.equal((await read('device-workspace-v1')).pending[0].id,before.pending[0].id);
 await expect(page.locator('#content')).toContainText('Créé avant le premier PC');
 await page.locator('[data-task=device-accounts]').first().click();await page.locator('[data-account-connect=twitch]').click();
 await expect(page.locator('[data-device-accounts]')).toContainText('EXAMPLE');await page.locator('[data-account-refresh]').click();
 await page.locator('[data-account-test=twitch]').click();await expect(page.locator('[data-device-accounts]')).toContainText('Compte de test');
 await page.locator('[data-task=close-dialog]').click();
 // Real IndexedDB, direct device adapters and no host, including partial success.
 const published=await page.evaluate(async()=>{
  const {openReplica}=await import('/control/autonomy-store.js'),{createLocalPlanning}=await import('/control/local-planning.js'),{createDeviceProviders}=await import('/control/device-providers.js');
  const store=await openReplica('device-workspace-v1');const planner=createLocalPlanning({store,providers:createDeviceProviders({})});
  localStorage.setItem('mock.rejectGoogle','yes');
  const {createdItemId}=await planner.route('/api/v2/planning',{title:'Publication autonome',category:'live',startAtUtc:'2030-11-01T18:00:00Z',endAtUtc:'2030-11-01T19:00:00Z',desiredPublication:{local:true,twitch:true,google:true}},'POST');
  const item=store.view().data.host.planning.find(x=>x.id===createdItemId);store.close();return item;
 });
 assert.equal(published.providers.twitch.status,'synced');assert.equal(published.providers.google.status,'error');
 await page.reload();await page.evaluate(()=>localStorage.removeItem('mock.rejectGoogle'));
 await page.evaluate(async id=>{
  const {openReplica}=await import('/control/autonomy-store.js'),{createLocalPlanning}=await import('/control/local-planning.js'),{createDeviceProviders}=await import('/control/device-providers.js');
  const store=await openReplica('device-workspace-v1');await createLocalPlanning({store,providers:createDeviceProviders({})}).route(`/api/v1/planning/${id}/retry/google`,{},'POST');
  await store.addSound(new File([new Uint8Array([82,73,70,70,0,0,0,0,87,65,86,69])],'test.wav',{type:'audio/wav'}),'Son local');store.close();
 },published.id);
 assert.equal(await page.evaluate(()=>localStorage.getItem('mock.twitch.Create')),'1');
 assert.equal((await read('device-workspace-v1')).localPlanning.find(x=>x.id===published.id).providers.google.status,'synced');
 // Associate a newly started, generic host. No automatic overwrite/import.
 host=await startDashboardServer({port:0,host:'0.0.0.0',remoteEnabled:true,obsEnabled:false,dataDir:path.join(dir,'host'),logger:{info(){},warn(){},error(){}}});
 const api=async(p,b)=>{const r=await fetch(host.url+p,{method:b?'POST':'GET',headers:{'Content-Type':'application/json'},...(b?{body:JSON.stringify(b)}:{})});return r.json();};
 const pairing=await api('/api/v1/remote/pairing',{management:true});
 const address=Object.values(networkInterfaces()).flat().find(x=>x?.family==='IPv4'&&!x.internal).address;
 const remote=`http://${address}:${host.port}`;
 await page.locator('[data-task=connection]').first().click();await page.locator('#connection-form [name=link]').fill(`${remote}/mobile/control/?pair=${pairing.id}&code=${pairing.code}`);
 await page.locator('#connection-form button:not([type])').click();await expect(page.locator('#dialog')).not.toBeVisible();
 assert.equal((await api('/api/v2/autonomy')).bundle.data.host.planning.length,0);
 await page.locator('[data-page=manage]').first().click();await page.locator('[data-page=settings]').last().click();await page.locator('[data-tab=devices]').click();
 await page.locator('[data-task=import-local]').click();await expect(page.locator('#dialog')).toContainText('Créé avant le premier PC');await page.locator('[data-task=import-local-apply]').click();
 try{await expect.poll(async()=>(await api('/api/v2/autonomy')).bundle.data.host.planning.some(x=>x.id===id)).toBe(true);}catch(e){console.error('TRANSFER',await page.locator('#notice').textContent(),(await read(remote)).pending.map(x=>({key:x.key,issue:x.issue})));throw e;}
 assert.equal((await read('device-workspace-v1')).pending.length,0);
 // Repeated import cannot duplicate the event; local original remains readable.
 await page.evaluate(async remote=>{const {openReplica}=await import('/control/autonomy-store.js');const s=await openReplica(remote);await s.importLocal('device-workspace-v1');s.close();},remote);
 assert.equal((await api('/api/v2/autonomy')).bundle.data.host.planning.length,2);
 const transferred=(await api('/api/v2/autonomy')).bundle.data.host.planning.find(x=>x.id===published.id);assert.equal(transferred.providers.google.remoteId,'google-'+published.id);
 assert.equal((await api('/api/v1/soundboard')).sounds.length,1);
 assert.equal((await read('device-workspace-v1')).localPlanning.find(x=>x.id===published.id).editable,false);
 assert.equal((await read('device-workspace-v1')).bundle.data.host.planning[0].title,'Créé avant le premier PC');
 const response=await api('/api/v1/obs/test',{});assert.match(response.error?.message||response.error,/désactivé/);
 assert.equal((await api('/api/v2/autonomy')).bundle.data.receipts.length,0);
 assert.deepEqual(errors,[]);
 await mkdir('test-results/device-workspace',{recursive:true});await page.screenshot({path:'test-results/device-workspace/phone-devices.png',fullPage:true});
 console.log('PASS: independent phone, IndexedDB restart, direct publications, partial retry without duplicate, local audio import, identity/file transfer, duplicate transfer, OBS disabled, zero live/chat actions.');
}finally{await context?.close();await host?.stop();await new Promise(r=>assetServer.close(r));await rm(dir,{recursive:true,force:true});}
