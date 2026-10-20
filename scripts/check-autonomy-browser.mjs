import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir, networkInterfaces } from 'node:os';
import path from 'node:path';
import express from 'express';
import { chromium, expect } from '@playwright/test';
import { startDashboardServer } from '../dist/apps/server/src/index.js';
const dir=await mkdtemp(path.join(tmpdir(),'sd-autonomy-browser-'));
const assets=express();assets.use(express.static(path.resolve('apps/mobile')));
const assetServer=assets.listen(48134,'127.0.0.1');await new Promise(resolve=>assetServer.once('listening',resolve));
const local=`http://127.0.0.1:${assetServer.address().port}`;
const options={port:0,host:'0.0.0.0',remoteEnabled:true,dataDir:dir,logger:{info(){},warn(){},error(){}}};
let host,context,other,browser;
try{
 host=await startDashboardServer(options);
 const api=async(p,b,m=b===undefined?'GET':'POST')=>{const r=await fetch(host.url+p,{method:m,headers:{'Content-Type':'application/json'},...(b===undefined?{}:{body:JSON.stringify(b)})});const result=await r.json();assert.ok(r.ok,JSON.stringify(result));return result;};
 const pair=await api('/api/v1/remote/pairing',{management:true}),paired=await api('/api/v1/remote/pair',{id:pair.id,code:pair.code,name:'Offline test'});
 const address=Object.values(networkInterfaces()).flat().find(x=>x?.family==='IPv4'&&!x.internal)?.address;assert.ok(address);
 const remote=`http://${address}:${host.port}`,errors=[];
 const init=async c=>{await c.addInitScript(({remote,credential})=>{localStorage.setItem('sd2.server',remote);localStorage.setItem('streamdashboard.device',credential);localStorage.setItem('sd2.page','deck');localStorage.setItem('sd2.monitor-enabled','false');},{remote,credential:paired.credential});};
 context=await chromium.launchPersistentContext(path.join(dir,'browser'),{headless:true,viewport:{width:412,height:915}});await init(context);
 let page=await context.newPage();page.on('pageerror',e=>{errors.push(e.message);console.log('BROWSER ERROR',e.message);});page.on('dialog',d=>d.accept());await page.goto(local+'/control/?role=client');
 await expect(page.locator('#connection')).toContainText('Régie connectée');
 // Real UI: create and persist an event while API requests are unavailable.
 await context.route(remote+'/**',r=>r.abort('connectionrefused'));await page.reload();await expect(page.locator('#connection')).toContainText('Mode local');
 await page.locator('[data-page="manage"]').first().click();await page.locator('[data-page="planning"]').last().click();await page.locator('[data-planning="new"]').click();
 await page.locator('#planning-event-form [name="title"]').fill('Événement hors ligne');await page.locator('#planning-event-form button:not([type])').click();await expect(page.locator('#dialog')).not.toBeVisible();
 await expect(page.locator('#connection')).toContainText('1 modification');
 const read=()=>page.evaluate(async remote=>{const {openReplica}=await import('/control/autonomy-store.js');const r=await openReplica(remote);const record=r.record;r.close();return record;},remote);
 let record=await read();const eventOp=record.pending[0];assert.equal(eventOp.key.split('/')[0],'planning');
 // Close the browser entirely; on restart only packaged assets are reachable.
 await context.close();context=await chromium.launchPersistentContext(path.join(dir,'browser'),{headless:true,viewport:{width:412,height:915}});await context.route(remote+'/**',r=>r.abort('connectionrefused'));
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(local+'/control/?role=client');await expect(page.locator('#connection')).toContainText('1 modification');
 record=await read();assert.equal(record.pending[0].id,eventOp.id);assert.equal(record.pending[0].value.title,'Événement hors ligne');
 await page.locator('[data-page="deck"]').first().click();await expect(page.locator('[data-action="micro"]')).toBeDisabled();
 await context.unroute(remote+'/**');await expect(page.locator('#connection')).toContainText('Régie connectée',{timeout:15000});await expect.poll(async()=>(await read()).pending.length).toBe(0);
 let bundle=await api('/api/v2/autonomy');const id=eventOp.key.split('/')[1];assert.equal(bundle.bundle.data.host.planning.filter(e=>e.id===id).length,1);
 // Use the same production replica and transport APIs for concurrent edit/conflict scenarios.
 const stage=async(p,changes)=>p.evaluate(async({remote,changes})=>{const {openReplica}=await import('/control/autonomy-store.js');const r=await openReplica(remote);await r.stage(changes);r.close();},{remote,changes});
 browser=await chromium.launch({headless:true});other=await browser.newContext();await init(other);const second=await other.newPage();await second.goto(local+'/control/?role=client');await expect(second.locator('#connection')).toContainText('Régie connectée');
 await context.route(remote+'/**',r=>r.abort('connectionrefused'));await other.route(remote+'/**',r=>r.abort('connectionrefused'));
 const original=eventOp.value;
 await stage(page,{['planning/'+id]:{...original,title:'Version téléphone'}});
 await stage(second,{['planning/'+id]:{...original,title:'Version PC'}});
 await other.unroute(remote+'/**');await expect.poll(async()=>(await api('/api/v2/autonomy')).bundle.data.host.planning.find(e=>e.id===id).title).toBe('Version PC');
 await context.unroute(remote+'/**');await expect.poll(async()=>(await read()).pending[0]?.issue?.status).toBe('conflict');
 await page.locator('#sync-status').click();await expect(page.locator('#dialog')).toContainText('Version téléphone');await expect(page.locator('#dialog')).toContainText('Version PC');
 await page.locator('[data-sync-remote]').click();await expect.poll(async()=>(await read()).pending.length).toBe(0);await page.locator('[data-task="close-dialog"]').click();
 // Independent field changes merge; an unrelated action is also synchronized.
 await context.route(remote+'/**',r=>r.abort('connectionrefused'));const current=(await read()).bundle.data.host.planning.find(e=>e.id===id);
 const {pick,fields}=await import('../apps/mobile/shared/autonomy.js');
 await stage(page,{['planning/'+id]:{...pick(current,fields.planning),description:'Texte local'},'action/offline-button':{id:'offline-button',label:'Pause locale',type:'mode.set',value:'pause',color:'amber',shortcut:''}});
 const latest=await api('/api/v2/state');await api('/api/v2/planning/'+id,{...pick(current,fields.planning),title:'Titre serveur',expectedRevision:latest.host.planningRevisions[id],confirmRecurring:true},'PUT');
 await context.unroute(remote+'/**');await expect.poll(async()=>(await read()).pending.length).toBe(0);
 bundle=await api('/api/v2/autonomy');const merged=bundle.bundle.data.host.planning.find(e=>e.id===id);assert.equal(merged.title,'Titre serveur');assert.equal(merged.description,'Texte local');assert.ok(bundle.bundle.data.configuration.actions.some(a=>a.id==='offline-button'));
 // Lost ACK: commit a new event, then discard its HTTP response. Retry after restart is a no-op.
 let lost=false;await context.route(remote+'/api/v2/autonomy/sync',async route=>{await route.fetch();lost=true;await route.abort('connectionreset');});
 await stage(page,{'planning/lost-ack-event':{...original,title:'Unique malgré la coupure'}});await expect.poll(()=>lost).toBe(true);await context.unroute(remote+'/api/v2/autonomy/sync');
 const oldWorkspace=(await api('/api/v2/autonomy')).workspace;const port=host.port;await host.stop();host=await startDashboardServer({...options,port});
 await expect.poll(async()=>(await read()).pending.length,{timeout:20000}).toBe(0);bundle=await api('/api/v2/autonomy');assert.equal(bundle.workspace,oldWorkspace);assert.equal(bundle.bundle.data.host.planning.filter(e=>e.id==='lost-ack-event').length,1);
 // Settings, templates, recurrence and automation definitions survive the same offline route.
 await context.route(remote+'/**',r=>r.abort('connectionrefused'));
 const settings=(await read()).bundle.data.host.settings;
 const series={...original,title:'Série autonome',recurrence:{version:2,frequency:'daily',interval:1,timeZone:'Europe/Paris',until:null,exceptions:{}}};
 await stage(page,{'planning/offline-series':series,'settings/root':{...pick(settings,fields.settings),streamerName:'Copie autonome'},'template/offline-template':{title:'Modèle local',desiredPublication:{local:true,twitch:false,google:false}},'automation/offline-rule':{name:'Règle locale',enabled:false,trigger:'test.support',conditions:[],actions:[{type:'timer.add',payload:{seconds:60}}],cooldownMs:0}});
 await context.unroute(remote+'/**');await expect.poll(async()=>(await read()).pending.length).toBe(0);
 bundle=await api('/api/v2/autonomy');assert.equal(bundle.bundle.data.host.settings.streamerName,'Copie autonome');assert.ok(bundle.bundle.extras.templates.some(x=>x.id==='offline-template'));assert.ok(bundle.bundle.extras.automations.some(x=>x.id==='offline-rule'));
 const {expandEditableRecurringItems}=await import('../apps/mobile/shared/recurrence.js');const master=bundle.bundle.data.host.planning.find(x=>x.id==='offline-series'),occurrence=expandEditableRecurringItems([master],{from:Date.parse(original.startAtUtc)-1000,to:Date.parse(original.startAtUtc)+86400000})[0];assert.ok(occurrence.occurrenceKey);
 await context.route(remote+'/**',r=>r.abort('connectionrefused'));
 await page.evaluate(async({remote,key})=>{const {createAutonomy}=await import('/control/autonomy.js');const a=await createAutonomy(remote,()=>{throw new Error('offline');});await a.mutate('/api/v2/planning/offline-series/occurrence',{occurrenceKey:key,patch:{title:'Une seule occurrence'}},'PUT');a.store.close();},{remote,key:occurrence.occurrenceKey});
 await context.unroute(remote+'/**');await expect.poll(async()=>(await read()).pending.length).toBe(0);
 bundle=await api('/api/v2/autonomy');assert.equal(bundle.bundle.data.host.planning.find(x=>x.id==='offline-series').recurrence.exceptions[occurrence.occurrenceKey].patch.title,'Une seule occurrence');
 await context.route(remote+'/**',r=>r.abort('connectionrefused'));await stage(page,{'planning/offline-series':null,'template/offline-template':null,'automation/offline-rule':null});await context.unroute(remote+'/**');await expect.poll(async()=>(await read()).pending.length).toBe(0);
 bundle=await api('/api/v2/autonomy');assert.ok(!bundle.bundle.data.host.planning.some(x=>x.id==='offline-series'));assert.ok(!bundle.bundle.extras.templates.some(x=>x.id==='offline-template'));assert.ok(!bundle.bundle.extras.automations.some(x=>x.id==='offline-rule'));
 // A locally edited control mapping must never execute the server's previous configuration.
 await stage(page,{'settings/root':{...pick(bundle.bundle.data.host.settings,fields.settings),streamerName:''}});
 await expect.poll(async()=>(await read()).pending[0]?.issue?.status).toBe('rejected');
 await expect(page.locator('#connection')).toContainText('Régie connectée');await expect(page.locator('[data-action="micro"]')).toBeDisabled();
 await page.locator('#sync-status').click();await page.locator('[data-sync-remote]').click();await page.locator('[data-task="close-dialog"]').click();await expect(page.locator('[data-action="micro"]')).toBeEnabled();
 assert.equal(bundle.bundle.data.receipts.length,0,'No live/OBS/chat command may be queued or executed');assert.deepEqual(errors,[]);
 await mkdir('test-results/autonomy',{recursive:true});await page.locator('#sync-status').click();await page.screenshot({path:'test-results/autonomy/phone-sync.png',fullPage:true});
 console.log('PASS: offline UI creation, browser restart, disabled execution, sync, conflict comparison, field merge, independent buttons, lost ACK, host restart, settings, templates, recurring occurrence and deletion, automation definitions, no execution replay.');
}finally{await other?.close();await browser?.close();await context?.close();await host?.stop();await new Promise(resolve=>assetServer.close(resolve));await rm(dir,{recursive:true,force:true});}
