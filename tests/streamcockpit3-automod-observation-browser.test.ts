import {it,expect} from 'vitest';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

const run=process.env.SC3_FINAL_BROWSER_TEST==='1'?it:it.skip;
const bundle=()=>build({stdin:{contents:`import {mountTwitchModeration} from './apps/mobile/control/streamcockpit-twitch-moderation.js';window.mountModeration=mountTwitchModeration;`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
run('F02 real Edge 320px: manual AutoMod read, escaped text and zero automatic/public writes',async()=>{
  const output=await bundle(),browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    await page.setContent('<main id="root"></main>');await page.addScriptTag({content:output.outputFiles[0].text});
    await page.evaluate(()=>{
      const w=window as any;
      w.calls=[];
      w.panel=w.mountModeration(document.getElementById('root'),{request:async(path:string,_body:unknown,method:string,host:string)=>{
        w.calls.push({path,method,host});
        if(path.endsWith('/viewer/12'))return {schemaVersion:1,kind:'streamcockpit-automod-viewer-observed',
          status:'partial-observation',observedAt:Date.now(),entries:[{status:'denied',observedAt:Date.now()}]};
        return {schemaVersion:1,kind:'streamcockpit-automod-observed',status:'partial-observation',
          observedAt:Date.now(),messages:[{id:'held-1',broadcasterId:'42',userId:'12',
          userName:'Viewer',text:'<script>window.leaked=true</script>',reason:'automod',heldAt:'2026-11-03T15:00:00Z'}]};
      }});
      w.panel.update({online:true,sourceKey:'FIXE',accountKey:'42'});
    });
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(0);
    await page.getByRole('button',{name:'Lire les retenues observées'}).click();
    await expect.poll(()=>page.getByLabel('Retenues AutoMod observées').locator('li').count()).toBe(1);
    expect(await page.getByLabel('Retenues AutoMod observées').textContent()).toContain('<script>');
    expect(await page.evaluate(()=>(window as any).leaked)).toBeUndefined();
    expect(await page.evaluate(()=>(window as any).calls)).toEqual([{path:'/api/v1/twitch/advanced/moderation/held',method:'GET',host:'FIXE'}]);
    await page.getByRole('button',{name:'Voir l’activité AutoMod observée'}).click();
    await expect.poll(()=>page.getByLabel('Activité AutoMod observée du viewer').locator('li').count()).toBe(1);
    expect(await page.getByLabel('Activité AutoMod observée du viewer').textContent()).toContain('Refusé');
    expect(await page.locator('main').textContent()).toContain('Ce n’est pas l’historique complet');
    expect(await page.evaluate(()=>(window as any).calls[1])).toEqual({
      path:'/api/v1/twitch/advanced/moderation/viewer/12',method:'GET',host:'FIXE'});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
    await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
    await expect.poll(()=>page.getByLabel('Retenues AutoMod observées').locator('li').count()).toBe(0);
    expect(await page.getByLabel('Activité AutoMod observée du viewer').locator('li').count()).toBe(0);
    expect(await page.getByRole('button',{name:'Lire les retenues observées'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
  }finally{await browser.close()}
},30000);
run('F02 Edge 320px: a late viewer response cannot survive a manual refresh or offline transition',async()=>{
  const output=await bundle(),browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    await page.setContent('<main id="root"></main>');await page.addScriptTag({content:output.outputFiles[0].text});
    await page.evaluate(()=>{
      const w=window as any;w.calls=[];w.viewerReads=0;
      w.panel=w.mountModeration(document.getElementById('root'),{request:async(path:string,_body:unknown,method:string)=>{
        w.calls.push(method);
        if(path.endsWith('/held'))return {schemaVersion:1,kind:'streamcockpit-automod-observed',
          status:'partial-observation',observedAt:Date.now(),messages:[{id:'a',userId:'12',
            userName:'Seen',text:'review',heldAt:'2026-11-06T06:00:00Z'}]};
        w.viewerReads++;
        if(w.viewerReads===1)return new Promise(resolve=>{w.releaseViewer=resolve;});
        return {schemaVersion:1,kind:'streamcockpit-automod-viewer-observed',
          status:'partial-observation',observedAt:Date.now(),entries:[{status:'approved',observedAt:Date.now()}]};
      }});
      w.panel.update({online:true,sourceKey:'FIXE',accountKey:'42'});
    });
    const refresh=page.getByRole('button',{name:'Lire les retenues observées'});
    const activity=page.getByRole('button',{name:'Voir l’activité AutoMod observée'});
    await refresh.click();
    await expect.poll(()=>activity.count()).toBe(1);
    await activity.click();
    await expect.poll(()=>page.evaluate(()=>(window as any).viewerReads)).toBe(1);
    await refresh.click();
    await expect.poll(()=>activity.count()).toBe(1);
    await page.evaluate(()=>(window as any).releaseViewer({schemaVersion:1,kind:'streamcockpit-automod-viewer-observed',
      status:'partial-observation',observedAt:Date.now(),entries:[{status:'denied',observedAt:Date.now()}]}));
    expect(await page.getByLabel('Activité AutoMod observée du viewer').locator('li').count()).toBe(0);
    await activity.click();
    await expect.poll(()=>page.getByLabel('Activité AutoMod observée du viewer').locator('li').count()).toBe(1);
    expect(await page.getByLabel('Activité AutoMod observée du viewer').textContent()).toContain('Approuvé');
    await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
    expect(await page.getByLabel('Activité AutoMod observée du viewer').locator('li').count()).toBe(0);
    expect(await page.evaluate(()=>(window as any).calls)).toEqual(['GET','GET','GET','GET']);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
  }finally{await browser.close()}
},30000);
