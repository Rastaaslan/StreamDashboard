import {test,expect} from '@playwright/test';
import express from 'express';
import type {Server} from 'node:http';
import path from 'node:path';
let server:Server,origin:string;
test.beforeAll(async()=>{
 const app=express();app.use('/mobile',express.static(path.resolve('apps/mobile')));
 app.get('/',(_req,res)=>res.send('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/mobile/control/control.css"><main style="padding:24px"><div id="feed"></div></main>'));
 server=await new Promise<Server>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
test.afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));});
test('old offline cache hides widget controls before its limit and preserves viewer activity',async({page})=>{
 await page.goto(origin);
 await page.evaluate(async()=>{
  localStorage.clear();
  const at=new Date().toISOString();
  const controls=Array.from({length:105},(_,i)=>({id:'control-'+i,type:['rollendcredits','SESSION_RESET','User-State-Session-Reset'][i%3],platform:'streamlabs',displayName:'Commande interne',receivedAt:at}));
  const activity=[{id:'follow',type:'follow',platform:'twitch',displayName:'Viewer conservé',receivedAt:at},{id:'future',type:'merch',platform:'streamlabs',displayName:'Achat conservé',receivedAt:at}];
  localStorage.setItem('sd2.streamlabs.history:host',JSON.stringify({items:[...controls,...activity],provider:{status:'CONNECTED'},at}));
  const modulePath='/mobile/control/streamlabs-feed.js';const module=await import(modulePath);
  const feed=module.createStreamlabsFeed(document.querySelector('#feed'),{request:async()=>{throw Error('Source hors ligne');},configure:()=>{}});
  feed.update([{id:'host',label:'Régie · FIXE'}]);
 });
 await expect(page.locator('.streamlabs-event')).toHaveCount(2);
 await expect(page.locator('[data-feed-events]')).toContainText('Viewer conservé');
 await expect(page.locator('[data-feed-events]')).toContainText('Achat conservé');
 await expect(page.locator('[data-feed-events]')).not.toContainText('Commande interne');
 await expect(page.locator('[data-feed-status]')).toContainText('réception non confirmée');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sd2.streamlabs.history:host')!).items.map((e:any)=>e.id))).toEqual(['follow','future']);
});
test('old server controls stay out of visible and cached history while gifts remain available',async({page})=>{
 await page.goto(origin);
 await page.evaluate(async()=>{
  localStorage.clear();
  const modulePath='/mobile/control/streamlabs-feed.js';const module=await import(modulePath);const at=new Date().toISOString();
  const feed=module.createStreamlabsFeed(document.querySelector('#feed'),{request:async()=>({provider:{status:'CONNECTED'},items:[
   ...['rollendcredits','sessionreset','USER_STATE_SESSION_RESET'].map((type,i)=>({id:'control-'+i,type,platform:'streamlabs',displayName:'Commande interne',receivedAt:at})),
   {id:'follow',type:'follow',platform:'twitch',displayName:'rollendcredits',message:'Viewer réel portant ce nom',receivedAt:at},
   {id:'gift',type:'subscription',platform:'twitch',displayName:'Ada',subType:'gift',recipient:'Dam',receivedAt:at},
  ]}),configure:()=>{}});
  feed.update([{id:'host',label:'Régie · FIXE'}]);
 });
 await expect(page.locator('.streamlabs-event')).toHaveCount(2);
 await expect(page.locator('[data-feed-events]')).not.toContainText('Commande interne');
 await expect(page.locator('[data-feed-events]')).toContainText('Viewer réel portant ce nom');
 await expect(page.locator('[data-feed-events]')).toContainText('Abonnement offert');
 await page.getByLabel('Type d’événement Streamlabs').selectOption('subscription');
 await expect(page.locator('.streamlabs-event')).toHaveCount(1);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sd2.streamlabs.history:host')!).items.map((e:any)=>e.id))).toEqual(['follow','gift']);
});
test('desktop feed filters real-shaped events, isolates sources and keeps offline history without claiming connected',async({page})=>{
 await page.setViewportSize({width:1366,height:900});await page.goto(origin);
 await page.evaluate(async()=>{
  const win=window as any;const modulePath='/mobile/control/streamlabs-feed.js';const module=await import(modulePath);
  const now=new Date().toISOString();win.fail=false;win.calls=[];
  win.feed=module.createStreamlabsFeed(document.querySelector('#feed'),{request:async(source:string)=>{
   win.calls.push(source);if(win.fail)throw Error('Régie inaccessible');
   return {provider:{status:'CONNECTED'},items:source==='host'?[
    {id:'f',platform:'twitch',type:'follow',displayName:'<img src=x onerror=alert(1)>',message:'Bienvenue <script>alert(1)</script>',receivedAt:now},
    {id:'yt',platform:'youtube',type:'superchat',displayName:'Luna',message:'Bon live !',amount:2,currency:'EUR',receivedAt:now},
    {id:'r',platform:'twitch',type:'raid',displayName:'Alex',count:138,receivedAt:now},
   ]:[{id:'own',platform:'streamlabs',type:'donation',displayName:'Connexion indépendante',amount:5,currency:'EUR',receivedAt:now}]};
  },configure:()=>{win.configured=true;}});
  win.feed.update([{id:'host',label:'Régie · FIXE'},{id:'own',label:'Cet appareil · Laptop'}]);
 });
 await expect(page.locator('.streamlabs-event')).toHaveCount(3);
 await expect(page.locator('[data-feed-events] img, [data-feed-events] script')).toHaveCount(0);
 await page.getByLabel('Plateforme Streamlabs').selectOption('youtube');await expect(page.locator('.streamlabs-event')).toHaveCount(1);await expect(page.locator('.streamlabs-detail')).toContainText('2,00');
 await page.getByLabel('Plateforme Streamlabs').selectOption('all');await page.getByLabel('Type d’événement Streamlabs').selectOption('raid');await expect(page.locator('.streamlabs-detail')).toHaveText('138 personnes');
 await page.getByLabel('Type d’événement Streamlabs').selectOption('all');
 await page.getByLabel('Source Streamlabs').selectOption('own');await expect(page.locator('.streamlabs-event')).toHaveCount(1);await expect(page.locator('.streamlabs-event')).toContainText('Connexion indépendante');
 await page.evaluate(()=>{(window as any).fail=true;});await page.getByRole('button',{name:'Actualiser',exact:true}).click();
 await expect(page.locator('[data-feed-status]')).toContainText('réception non confirmée');await expect(page.locator('.streamlabs-event')).toContainText('Connexion indépendante');
 await page.getByLabel('Source Streamlabs').selectOption('host');await expect(page.locator('.streamlabs-event')).toHaveCount(3);await expect(page.locator('[data-feed-status]')).toContainText('réception non confirmée');
 await page.getByRole('button',{name:'Configurer Streamlabs'}).click();expect(await page.evaluate(()=>(window as any).configured)).toBe(true);
 await page.screenshot({path:'test-results/streamlabs-feed-desktop.png',fullPage:true});
});

test('cloud history uses original dates and remains independent of the live connection',async({page})=>{
 await page.goto(origin);
 await page.evaluate(async()=>{
  localStorage.clear();const win=window as any;const modulePath='/mobile/control/streamlabs-feed.js';const module=await import(modulePath);
  win.fail=false;win.value={provider:{status:'DISCONNECTED'},history:{status:'SYNCED',configured:true,lastSyncAt:'2026-10-20T17:00:00.000Z',lastAttemptAt:'2026-10-20T17:00:00.000Z',count:91,lastError:null,widgetUrl:'must-not-be-cached'},items:[
   {id:'old-follow',type:'follow',platform:'twitch',displayName:'Ancien follow',origin:'cloud',occurredAt:'2017-10-04T19:20:08.000Z',receivedAt:'2026-10-20T17:00:00.000Z'},
   {id:'undated-follow',type:'follow',platform:'twitch',displayName:'Follow sans date connue',origin:'cloud',occurredAt:null,receivedAt:'2026-10-20T17:00:00.000Z'},
   {id:'live-follow',type:'follow',platform:'twitch',displayName:'Follow reçu en direct',occurredAt:null,receivedAt:'2026-10-20T17:01:00.000Z'},
  ]};
  win.feed=module.createStreamlabsFeed(document.querySelector('#feed'),{request:async()=>{if(win.fail)throw Error('Régie inaccessible');return win.value;},configure:()=>{}});
  win.feed.update([{id:'host',label:'Régie · FIXE'}]);
 });
 await expect(page.locator('[data-feed-history-status]')).toContainText('Historique du compte synchronisé · 91 événements');
 await expect(page.locator('[data-feed-history-status]')).toHaveClass(/succeeded/);
 await expect(page.locator('[data-feed-status]')).toContainText('Déconnecté');
 await expect(page.locator('[data-feed-status]')).not.toHaveClass(/succeeded/);
 const oldRow=page.locator('.streamlabs-event').filter({hasText:'Ancien follow'});
 await expect(oldRow.locator('time')).toHaveAttribute('datetime','2017-10-04T19:20:08.000Z');
 await expect(oldRow.locator('time')).toContainText('2017');
 await expect(oldRow.locator('time')).toHaveAttribute('title','Date de l’événement chez Streamlabs');
 const undatedRow=page.locator('.streamlabs-event').filter({hasText:'Follow sans date connue'});
 await expect(undatedRow.locator('time')).toHaveText('Date d’origine inconnue');
 await expect(undatedRow.locator('time')).not.toHaveAttribute('datetime');
 await expect(undatedRow.locator('time')).toHaveAttribute('title',/Récupéré le .*2026/);
 await expect(undatedRow).not.toContainText('2026');
 await expect(page.locator('.streamlabs-event').filter({hasText:'Follow reçu en direct'}).locator('time')).toHaveAttribute('datetime','2026-10-20T17:01:00.000Z');
 await expect(page.locator('[data-feed-history-note]')).toContainText('même si cette source était fermée');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sd2.streamlabs.history:host')!).history)).toEqual({status:'SYNCED',configured:true,lastSyncAt:'2026-10-20T17:00:00.000Z',lastAttemptAt:'2026-10-20T17:00:00.000Z',count:91,lastError:null});
 await page.evaluate(()=>{const win=window as any;win.value.provider.status='CONNECTED';win.value.history={...win.value.history,status:'ERROR',lastError:'Accès à Streamlabs temporairement indisponible'};});
 await page.getByRole('button',{name:'Actualiser',exact:true}).click();
 await expect(page.locator('[data-feed-status]')).toContainText('réception active');
 await expect(page.locator('[data-feed-status]')).toHaveClass(/succeeded/);
 await expect(page.locator('[data-feed-history-status]')).toContainText('synchronisation indisponible');
 await expect(page.locator('[data-feed-history-status]')).not.toHaveClass(/succeeded/);
 await expect(page.locator('.streamlabs-event')).toHaveCount(3);
 await page.evaluate(()=>{(window as any).fail=true;});
 await page.getByRole('button',{name:'Actualiser',exact:true}).click();
 await expect(page.locator('[data-feed-history-status]')).toContainText('synchronisation non confirmée');
 await expect(page.locator('.streamlabs-event')).toHaveCount(3);
});

test('manual refresh requests a cloud update while ordinary polling stays unforced',async({page})=>{
 await page.goto(origin);
 await page.evaluate(async()=>{
  localStorage.clear();const win=window as any;win.calls=[];const modulePath='/mobile/control/streamlabs-feed.js';const module=await import(modulePath);
  const feed=module.createStreamlabsFeed(document.querySelector('#feed'),{request:async(source:string,options:{refresh:boolean})=>{win.calls.push({source,refresh:options.refresh});return {provider:{status:'CONNECTED'},history:{status:'NOT_CONFIGURED',configured:false,count:0},items:[]};},configure:()=>{}});
  feed.update([{id:'host',label:'Régie · FIXE'}]);
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBeGreaterThanOrEqual(1);
 expect(await page.evaluate(()=>(window as any).calls[0])).toEqual({source:'host',refresh:true});
 await expect.poll(()=>page.evaluate(()=>(window as any).calls.some((call:any)=>call.refresh===false))).toBe(true);
 await page.getByRole('button',{name:'Actualiser',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).calls.at(-1).refresh)).toBe(true);
 await expect(page.locator('[data-feed-history-status]')).toContainText('Historique du compte à connecter');
 await expect(page.locator('[data-feed-status]')).toContainText('réception active');
});

test('history configuration sends only the entered widget URL and keeps live credentials separate',async({page})=>{
 await page.goto(origin);
 await page.evaluate(async()=>{
  localStorage.clear();const win=window as any;win.calls=[];win.changes=[];win.notices=[];win.documentSubmits=0;
  document.addEventListener('submit',()=>win.documentSubmits++);
  const modulePath='/mobile/control/streamlabs-feed.js';const module=await import(modulePath);
  module.createStreamlabsConfiguration(document.querySelector('#feed'),{label:'Régie · FIXE',request:async(path:string,body:any,method:string)=>{
   win.calls.push({path,body,method});
   if(path.endsWith('/history/status'))return {status:'SYNCED',configured:true,count:91,lastSyncAt:'2026-10-20T17:00:00.000Z',widgetUrl:'saved-secret-must-not-appear'};
   if(method==='DELETE')return {status:'NOT_CONFIGURED',configured:false,count:0,lastSyncAt:null};
   if(path.endsWith('/history/config'))return {status:'SYNCED',configured:true,count:92,lastSyncAt:'2026-10-20T17:10:00.000Z'};
   return {status:'CONNECTED'};
  },changed:(kind:string)=>win.changes.push(kind),notify:(message:string)=>win.notices.push(message)});
 });
 const widget=page.getByLabel('URL d’un widget Streamlabs');
 const socket=page.getByLabel('Socket Token Streamlabs');
 await expect(widget).toHaveAttribute('type','password');await expect(widget).toHaveValue('');await expect(socket).toHaveValue('');
 await expect(page.locator('[data-streamlabs-history-status]')).toContainText('91 événements');
 await expect(page.locator('#feed')).not.toContainText('saved-secret-must-not-appear');
 const widgetUrl='https://streamlabs.com/widgets/event-list/v1/fake-widget-credential-for-test';
 await widget.fill(widgetUrl);await page.getByRole('button',{name:'Enregistrer et récupérer l’historique'}).click();
 await expect(page.locator('[data-streamlabs-history-status]')).toContainText('92 événements');await expect(widget).toHaveValue('');
 expect(await page.evaluate(()=>(window as any).calls.find((call:any)=>call.method==='PUT'))).toEqual({path:'/api/v1/supports/streamlabs/history/config',body:{widgetUrl},method:'PUT'});
 await page.getByRole('button',{name:'Déconnecter l’historique'}).click();
 await expect(page.locator('[data-streamlabs-history-status]')).toContainText('Historique du compte à connecter');
 await expect(page.getByRole('button',{name:'Déconnecter l’historique'})).toBeDisabled();
 await socket.fill('fake-socket-credential-for-test');await page.getByRole('button',{name:'Connecter et enregistrer',exact:true}).click();
 await expect(page.locator('[data-streamlabs-direct-status]')).toContainText('réception active');await expect(socket).toHaveValue('');
 expect(await page.evaluate(()=>(window as any).calls.filter((call:any)=>call.path==='/api/v1/supports/streamlabs/config'))).toEqual([{path:'/api/v1/supports/streamlabs/config',body:{token:'fake-socket-credential-for-test'},method:'PUT'}]);
 expect(await page.evaluate(()=>(window as any).changes)).toEqual(['history','history','direct']);
 expect(await page.evaluate(()=>(window as any).documentSubmits)).toBe(0);
 expect(await page.evaluate(()=>localStorage.length)).toBe(0);
});

test('a late status response cannot replace saved history configuration and errors remain visible',async({page})=>{
 await page.goto(origin);
 await page.evaluate(async()=>{
  const win=window as any;win.fail=false;const modulePath='/mobile/control/streamlabs-feed.js';const module=await import(modulePath);
  module.createStreamlabsConfiguration(document.querySelector('#feed'),{label:'Cet appareil',request:async(path:string)=>{
   if(path.endsWith('/history/status'))return new Promise(resolve=>{win.resolveInitial=resolve;});
   if(win.fail)throw Error('Accès à cet historique refusé');
   return {status:'SYNCED',configured:true,count:58,lastSyncAt:'2026-10-20T17:00:00.000Z'};
  }});
 });
 const widget=page.getByLabel('URL d’un widget Streamlabs');
 await widget.fill('fake-widget-credential-for-test');await page.getByRole('button',{name:'Enregistrer et récupérer l’historique'}).click();
 await expect(page.locator('[data-streamlabs-history-status]')).toContainText('58 événements');
 await page.evaluate(()=>{(window as any).resolveInitial({status:'NOT_CONFIGURED',configured:false,count:0});});
 await expect(page.locator('[data-streamlabs-history-status]')).toContainText('58 événements');
 await expect(page.getByRole('button',{name:'Déconnecter l’historique'})).toBeEnabled();
 await page.evaluate(()=>{(window as any).fail=true;});
 await widget.fill('another-fake-widget-credential');await page.getByRole('button',{name:'Enregistrer et récupérer l’historique'}).click();
 await expect(page.locator('[data-streamlabs-history-status]')).toContainText('Accès à cet historique refusé');
 await expect(page.locator('[data-streamlabs-history-status]')).not.toHaveClass(/succeeded/);
 await expect(page.getByRole('button',{name:'Enregistrer et récupérer l’historique'})).toBeEnabled();
});
