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
