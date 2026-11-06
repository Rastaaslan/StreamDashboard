import {expect,it} from 'vitest';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

const run=process.env.SC3_FINAL_BROWSER_TEST==='1'?it:it.skip;
run('F02 Edge 320px: lookup of a selected viewer without an active held message stays GET-only and discards late wrong-host results',async()=>{
  const output=await build({stdin:{contents:"import {mountTwitchModeration} from './apps/mobile/control/streamcockpit-twitch-moderation.js';window.mount=mountTwitchModeration;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    await page.setContent('<main id="root"></main>');
    await page.addScriptTag({content:output.outputFiles[0].text});
    await page.evaluate(()=>{
      const w=window as any;w.calls=[];
      w.panel=w.mount(document.querySelector('#root'),{request:async(path:string,_body:unknown,method:string,host:string)=>{
        w.calls.push({path,method,host});
        if(method!=='GET'||!path.endsWith('/viewer/12'))throw Error('UNEXPECTED_PROVIDER_EFFECT');
        if(w.calls.length===2)return new Promise(resolve=>{w.release=resolve});
        return {schemaVersion:1,kind:'streamcockpit-automod-viewer-observed',status:'partial-observation',
          observedAt:Date.now(),entries:[{status:'denied',observedAt:Date.now()}]};
      }});
      w.panel.update({online:true,sourceKey:'FIXE',accountKey:'42'});
    });
    const input=page.getByLabel('Identifiant Twitch du viewer');
    const button=page.getByRole('button',{name:'Consulter l’activité AutoMod observée'});
    expect(await button.isDisabled()).toBe(true);
    await input.fill('invalid');expect(await button.isDisabled()).toBe(true);
    await input.fill('12');expect(await button.isEnabled()).toBe(true);
    await button.click();
    await expect.poll(()=>page.getByLabel('Activité AutoMod observée du viewer').locator('li').count()).toBe(1);
    expect(await page.locator('#root').textContent()).toContain('Ce n’est pas l’historique complet');
    expect(await page.getByLabel('Retenues AutoMod observées').locator('li').count()).toBe(0);
    await button.click();await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(2);
    await page.evaluate(()=>(window as any).panel.update({online:true,sourceKey:'OTHER_FIXE',accountKey:'43'}));
    await page.evaluate(()=>(window as any).release({schemaVersion:1,kind:'streamcockpit-automod-viewer-observed',status:'partial-observation',
      observedAt:Date.now(),entries:[{status:'approved',observedAt:Date.now()}]}));
    expect(await page.getByLabel('Activité AutoMod observée du viewer').locator('li').count()).toBe(0);
    expect(await input.inputValue()).toBe('');
    await input.fill('12');await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
    expect(await button.isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls)).toEqual([
      {path:'/api/v1/twitch/advanced/moderation/viewer/12',method:'GET',host:'FIXE'},
      {path:'/api/v1/twitch/advanced/moderation/viewer/12',method:'GET',host:'FIXE'}]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
  }finally{await browser.close()}
},30000);

run('F02 Edge 320px: changing the viewer ID while a GET is pending cannot label an old viewer as the new one',async()=>{
  const output=await build({stdin:{contents:"import {mountTwitchModeration} from './apps/mobile/control/streamcockpit-twitch-moderation.js';window.mount=mountTwitchModeration;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    await page.setContent('<main id="root"></main>');await page.addScriptTag({content:output.outputFiles[0].text});
    await page.evaluate(()=>{
      const w=window as any;w.calls=[];
      w.panel=w.mount(document.querySelector('#root'),{request:async(path:string,_body:unknown,method:string)=>{
        w.calls.push({path,method});
        if(path.endsWith('/viewer/12'))return new Promise(resolve=>{w.release=resolve});
        return {schemaVersion:1,kind:'streamcockpit-automod-viewer-observed',status:'partial-observation',observedAt:Date.now(),
          entries:[{status:'approved',observedAt:Date.now()}]};
      }});
      w.panel.update({online:true,sourceKey:'FIXE',accountKey:'42'});
    });
    const input=page.getByLabel('Identifiant Twitch du viewer');
    const button=page.getByRole('button',{name:'Consulter l’activité AutoMod observée'});
    await input.fill('12');await button.click();
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(1);
    await input.fill('34');
    await page.evaluate(()=>(window as any).release({
      schemaVersion:1,kind:'streamcockpit-automod-viewer-observed',status:'partial-observation',observedAt:Date.now(),
      entries:[{status:'denied',observedAt:Date.now()}]}));
    await expect.poll(()=>page.getByLabel('Activité AutoMod observée du viewer').locator('li').count()).toBe(0);
    expect(await button.isEnabled()).toBe(true);
    await button.click();
    await expect.poll(()=>page.getByLabel('Activité AutoMod observée du viewer').locator('li').count()).toBe(1);
    expect(await page.getByLabel('Activité AutoMod observée du viewer').textContent()).toContain('Approuvé');
    expect(await page.evaluate(()=>(window as any).calls.map((v:any)=>v.path.split('/').at(-1)))).toEqual(['12','34']);
  }finally{await browser.close()}
},30000);
