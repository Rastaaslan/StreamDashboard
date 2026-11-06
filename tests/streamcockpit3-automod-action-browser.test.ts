import {it,expect} from 'vitest';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

const run=process.env.SC3_FINAL_BROWSER_TEST==='1'?it:it.skip;
const bundle=()=>build({stdin:{contents:"import {mountTwitchModeration} from './apps/mobile/control/streamcockpit-twitch-moderation.js';window.mountModeration=mountTwitchModeration;",resolveDir:process.cwd()},
  bundle:true,write:false,format:'iife',platform:'browser'});
const setup=async(page:any,content:string)=>{
  await page.setContent('<main id="root"></main>');
  await page.addScriptTag({content});
  await page.evaluate(()=>{
    const w=window as any;w.calls=[];
    w.panel=w.mountModeration(document.getElementById('root'),{request:async(path:string,body:any,method:string)=>{
      w.calls.push({path,body,method});
      if(path.endsWith('/held'))return {schemaVersion:1,kind:'streamcockpit-automod-observed',status:'partial-observation',
        messages:[{id:'hold-1',broadcasterId:'42',userId:'12',userName:'Viewer',
          text:'<img src=x onerror=window.evil=true>',heldAt:'2026-11-06T10:00:00Z'}]};
      if(path.endsWith('/held-action/preview'))return {schemaVersion:1,kind:'streamcockpit-automod-action-preview',
        confirmationId:'confirmation-1',expiresAt:Date.now()+29_000,...body};
      if(path.endsWith('/held-action/confirm'))return {schemaVersion:1,kind:'streamcockpit-automod-action-receipt',
        status:'submitted-unverified',decision:'ALLOW'};
      throw Error('UNEXPECTED_REQUEST');
    }});
    w.panel.update({online:true,sourceKey:'FIXE',accountKey:'owner'});
  });
};
run('F02 real Edge 320px: paired observed hold requires two voluntary clicks and scope preview before a single submitted decision',async()=>{
  const js=(await bundle()).outputFiles[0].text,browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    await setup(page,js);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(0);
    await page.getByRole('button',{name:'Lire les retenues observées'}).click();
    await expect.poll(()=>page.getByLabel('Retenues AutoMod observées').locator('li').count()).toBe(1);
    expect(await page.evaluate(()=>(window as any).calls.map((x:any)=>x.method))).toEqual(['GET']);
    expect(await page.evaluate(()=>(window as any).evil)).toBeUndefined();
    await page.getByRole('button',{name:'Autoriser via Twitch'}).click();
    await expect.poll(()=>page.getByText('Aucune décision envoyée. Confirmation explicite requise.').count()).toBe(1);
    expect(await page.evaluate(()=>(window as any).calls.map((x:any)=>x.path.split('/').at(-1)))).toEqual(['held','preview']);
    expect(await page.getByRole('button',{name:'Envoyer la décision à Twitch'}).isDisabled()).toBe(true);
    await page.getByLabel('Confirmer la décision AutoMod').check();
    await page.getByRole('button',{name:'Envoyer la décision à Twitch'}).click();
    await expect.poll(()=>page.getByText(/Demande reçue par Twitch, mais décision non relue/).count()).toBe(1);
    expect(await page.evaluate(()=>(window as any).calls.map((x:any)=>x.path.split('/').at(-1)))).toEqual(['held','preview','confirm']);
    await page.getByRole('button',{name:'Refuser via Twitch'}).click();
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(3);
    expect(await page.getByRole('button',{name:'J’ai vérifié la décision dans Twitch'}).isVisible()).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
  }finally{await browser.close();}
},30000);

run('F02 real Edge 320px: offline during in-flight confirm never creates a second POST or restores stale consent',async()=>{
  const js=(await bundle()).outputFiles[0].text,browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    await page.setContent('<main id="root"></main>');await page.addScriptTag({content:js});
    await page.evaluate(()=>{
      const w=window as any;w.calls=[];
      w.panel=w.mountModeration(document.getElementById('root'),{request:async(path:string,body:any,method:string)=>{
        w.calls.push({path,method});
        if(path.endsWith('/held'))return {schemaVersion:1,kind:'streamcockpit-automod-observed',status:'partial-observation',
          messages:[{id:'hold-1',broadcasterId:'42',userId:'12',userName:'Viewer',text:'hold',heldAt:'2026-11-06T10:00:00Z'}]};
        if(path.endsWith('/preview'))return {schemaVersion:1,kind:'streamcockpit-automod-action-preview',
          confirmationId:'confirm',expiresAt:Date.now()+29_000,...body};
        if(path.endsWith('/confirm'))return await new Promise(resolve=>{w.resolveProvider=resolve;});
        throw Error('BAD_REQUEST');
      }});
      w.panel.update({online:true,sourceKey:'FIXE',accountKey:'owner'});
    });
    await page.getByRole('button',{name:'Lire les retenues observées'}).click();
    await page.getByRole('button',{name:'Autoriser via Twitch'}).click();
    await expect.poll(()=>page.getByLabel('Confirmer la décision AutoMod').isEnabled()).toBe(true);
    await page.getByLabel('Confirmer la décision AutoMod').check();
    await page.getByRole('button',{name:'Envoyer la décision à Twitch'}).click({noWaitAfter:true});
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.filter((v:any)=>v.method==='POST').length)).toBe(2);
    await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
    await page.evaluate(()=>{
      const w=window as any;
      setTimeout(()=>w.resolveProvider({schemaVersion:1,kind:'streamcockpit-automod-action-receipt',
        status:'submitted-unverified',decision:'ALLOW'}),0);
    });
    await expect.poll(()=>page.getByText(/Décision potentiellement envoyée/).count()).toBe(1);
    expect(await page.locator('button').filter({hasText:'Envoyer la décision à Twitch'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.filter((v:any)=>v.method==='POST').length)).toBe(2);
  }finally{await browser.close();}
},30000);