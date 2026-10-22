import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import express from 'express';
const app=express();app.use('/mobile',express.static('.build/public/mobile'));app.get('/fixture',(_q,r)=>r.send('<!doctype html><body></body>'));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}),origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/fixture');await page.evaluate(async()=>{localStorage.setItem('sd2.device',JSON.stringify({version:1,name:'Offline audit',role:'mobile',configured:true}));localStorage.setItem('sd2.workspace-mode','local');await caches.open('streamdashboard-mobile-old-audit');await caches.open('unrelated-cache');});
 await page.goto(origin+'/mobile/control/');await page.locator('#content h1').waitFor();
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.waitForFunction(()=>navigator.serviceWorker.controller);
 const before=await page.evaluate(async()=>({keys:await caches.keys(),requests:await (await caches.open((await caches.keys()).find(key=>key.startsWith('streamdashboard-control-')))).keys().then(entries=>entries.map(r=>new URL(r.url).pathname))}));
 assert(!before.keys.includes('streamdashboard-mobile-old-audit'));assert(before.keys.includes('unrelated-cache'));assert(!before.requests.some(url=>url.includes('/api/')));assert(before.requests.includes('/mobile/control/local-planning.js'));
 await context.setOffline(true);await page.reload();await page.locator('#content h1').waitFor();
 await page.locator('nav [data-page=planning]').click();await page.locator('[data-planning=new]').click();await page.locator('#planning-event-form').waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 const result={cachedFiles:before.requests.length,offlineReload:true,lazyPlanningOffline:true,oldAppCacheRemoved:true,otherCachePreserved:true,apiCached:false,errors};
 fs.writeFileSync('/tmp/sd-alpha4-offline.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
