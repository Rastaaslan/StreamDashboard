import {it,expect} from 'vitest';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

const origin='http://127.0.0.1:38653';
const uuid='643e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5';
const newer='743e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5';

it.skipIf(process.env.SC3_FINAL_BROWSER_TEST!=='1')('F04 two real Edge tabs: external uncertain POST immediately invalidates stale preview, then corruption blocks both',async()=>{
  const bundle=await build({stdin:{
    contents:"import {mountTwitchMoments} from './apps/mobile/control/streamcockpit-twitch-moments.js';window.mountMoments=mountTwitchMoments;",
    resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:320,height:720},hasTouch:true});
    await context.route('**/*',route=>route.abort());
    await context.route(origin+'/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<main id="root"></main>'}));
    const a=await context.newPage(),b=await context.newPage();
    const mount=async(page:typeof a)=>{
      await page.goto(origin+'/moments');
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      await page.evaluate((id)=>{
        const w=window as any;w.calls=[];
        w.panel=w.mountMoments(document.querySelector('#root'),{request:async(path:string,body:any,method:string)=>{
          w.calls.push({path,method});
          if(path.endsWith('/preview'))return {schemaVersion:1,kind:'streamcockpit-moment-preview',confirmationId:id,expiresAt:Date.now()+30_000,draft:body.draft};
          if(method==='GET')return {schemaVersion:1,kind:'streamcockpit-moment-status',status:'not_found_at_read',retryable:false};
          throw Error('SYNTHETIC_PROVIDER_FAILURE');
        }});
        w.panel.update({online:true,sourceKey:'FIXE',accountKey:'owner'});
      },uuid);
    };
    await mount(a);await mount(b);
    await a.getByRole('button',{name:'Vérifier le moment sans publier'}).click();
    await a.getByLabel('Confirmer le moment Twitch').check();
    expect(await a.getByRole('button',{name:'Créer ce moment sur Twitch'}).isEnabled()).toBe(true);
    await b.getByRole('button',{name:'Vérifier le moment sans publier'}).click();
    await b.getByLabel('Confirmer le moment Twitch').check();
    await b.getByRole('button',{name:'Créer ce moment sur Twitch'}).click();
    await expect.poll(()=>b.getByRole('status').textContent()).toContain('Résultat incertain');
    await expect.poll(()=>a.getByRole('status').textContent()).toContain('autre fenêtre');
    expect(await a.getByRole('button',{name:'Vérifier le moment sans publier'}).isDisabled()).toBe(true);
    expect(await a.getByRole('button',{name:'Créer ce moment sur Twitch'}).isVisible()).toBe(false);
    expect(await a.evaluate(()=>(window as any).calls.filter((c:any)=>c.path.endsWith('/confirm')).length)).toBe(0);
    // An external manual reconciliation clears the hint in B; A must discard its old confirmation.
    await b.getByRole('button',{name:'J’ai vérifié ce moment dans Twitch'}).click();
    await expect.poll(()=>a.getByRole('button',{name:'Vérifier le moment sans publier'}).isEnabled()).toBe(true);
    expect(await a.getByRole('button',{name:'Créer ce moment sur Twitch'}).isVisible()).toBe(false);
    // A malformed journal written in a second window fails closed without an outbound call.
    await b.evaluate(()=>localStorage.setItem('sd3.f04.twitch-moment-uncertain.v1','{corrupt'));
    await expect.poll(()=>a.getByRole('status').textContent()).toContain('Stockage des confirmations Twitch illisible');
    expect(await a.getByRole('button',{name:'Vérifier le moment sans publier'}).isDisabled()).toBe(true);
    expect(await a.evaluate(()=>(window as any).calls.filter((c:any)=>c.path.endsWith('/confirm')).length)).toBe(0);
    expect(await b.evaluate(()=>localStorage.getItem('sd3.f04.twitch-moment-uncertain.v1'))).toBe('{corrupt');
    await a.evaluate(()=>(window as any).panel.destroy());await b.evaluate(()=>(window as any).panel.destroy());
  }finally{await browser.close()}
},30000);

it.skipIf(process.env.SC3_FINAL_BROWSER_TEST!=='1')('F04 two real Edge tabs: stale acknowledgement cannot clear a newer pending UUID',async()=>{
  const bundle=await build({stdin:{
    contents:"import {rememberUncertainMoment,clearUncertainMoment,loadUncertainMoment} from './apps/mobile/control/streamcockpit-twitch-moment-pending.js';Object.assign(window,{rememberUncertainMoment,clearUncertainMoment,loadUncertainMoment});",
    resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext();
    await context.route('**/*',route=>route.abort());
    await context.route(origin+'/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<main></main>'}));
    const a=await context.newPage(),b=await context.newPage();
    for(const page of [a,b]){await page.goto(origin+'/receipts');await page.addScriptTag({content:bundle.outputFiles[0].text})}
    const read=()=>b.evaluate(()=>(window as any).loadUncertainMoment(window,'FIXE','owner'));
    expect(await a.evaluate(id=>(window as any).rememberUncertainMoment(window,'FIXE','owner',{id,kind:'clip'}),uuid)).toBe(true);
    expect(await read()).toEqual({id:uuid,kind:'clip'});
    expect(await b.evaluate(id=>(window as any).clearUncertainMoment(window,'FIXE','owner',{id,kind:'clip'}),uuid)).toBe(true);
    expect(await b.evaluate(id=>(window as any).rememberUncertainMoment(window,'FIXE','owner',{id,kind:'marker'}),newer)).toBe(true);
    const before=await b.evaluate(()=>localStorage.getItem('sd3.f04.twitch-moment-uncertain.v1'));
    expect(await a.evaluate(id=>(window as any).clearUncertainMoment(window,'FIXE','owner',{id,kind:'clip'}),uuid)).toBe(false);
    expect(await b.evaluate(()=>localStorage.getItem('sd3.f04.twitch-moment-uncertain.v1'))).toBe(before);
    expect(await read()).toEqual({id:newer,kind:'marker'});
  }finally{await browser.close()}
},30000);

it.skipIf(process.env.SC3_FINAL_BROWSER_TEST!=='1')('F04 real Edge tabs: native journal lock contention forbids a provider POST, then allows an explicit new attempt',async()=>{
  const bundle=await build({stdin:{
    contents:"import {mountTwitchMoments} from './apps/mobile/control/streamcockpit-twitch-moments.js';window.mountMoments=mountTwitchMoments;",
    resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:320,height:720},hasTouch:true});
    await context.route('**/*',route=>route.abort());
    await context.route(origin+'/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<main id="root"></main>'}));
    const a=await context.newPage(),b=await context.newPage();
    await a.goto(origin+'/lock');await b.goto(origin+'/lock');
    await b.addScriptTag({content:bundle.outputFiles[0].text});
    await b.evaluate(id=>{
      const w=window as any;w.calls=[];
      w.panel=w.mountMoments(document.querySelector('#root'),{request:async(path:string,body:any,method:string)=>{
        w.calls.push({path,method});
        if(path.endsWith('/preview'))return {schemaVersion:1,kind:'streamcockpit-moment-preview',confirmationId:id,expiresAt:Date.now()+30_000,draft:body.draft};
        throw Error('SYNTHETIC_PROVIDER_FAILURE');
      }});
      w.panel.update({online:true,sourceKey:'FIXE',accountKey:'owner'});
    },uuid);
    // A browser/WebView without Web Locks must never fall back to an unlocked POST.
    await b.evaluate(()=>Object.defineProperty(navigator,'locks',{configurable:true,value:undefined}));
    await b.getByRole('button',{name:'Vérifier le moment sans publier'}).click();
    await b.getByLabel('Confirmer le moment Twitch').check();
    await b.getByRole('button',{name:'Créer ce moment sur Twitch'}).click();
    await expect.poll(()=>b.getByRole('status').textContent()).toContain('Sauvegarde locale de la demande impossible');
    expect(await b.evaluate(()=>(window as any).calls.filter((c:any)=>c.path.endsWith('/confirm')).length)).toBe(0);
    expect(await b.evaluate(()=>localStorage.getItem('sd3.f04.twitch-moment-uncertain.v1'))).toBeNull();
    await b.evaluate(()=>{delete (navigator as any).locks});
    await a.evaluate(()=>{
      const w=window as any;
      void navigator.locks.request('sd3.f04.twitch-moment-journal.v1',{mode:'exclusive'},async()=>{
        w.held=true;await new Promise<void>(resolve=>{w.release=resolve});
      });
    });
    await expect.poll(()=>a.evaluate(()=>(window as any).held===true)).toBe(true);
    await b.getByRole('button',{name:'Vérifier le moment sans publier'}).click();
    await b.getByLabel('Confirmer le moment Twitch').check();
    await b.getByRole('button',{name:'Créer ce moment sur Twitch'}).click();
    await expect.poll(()=>b.getByRole('status').textContent()).toContain('Sauvegarde locale de la demande impossible');
    expect(await b.evaluate(()=>(window as any).calls.filter((c:any)=>c.path.endsWith('/confirm')).length)).toBe(0);
    expect(await b.evaluate(()=>localStorage.getItem('sd3.f04.twitch-moment-uncertain.v1'))).toBeNull();
    await a.evaluate(()=>(window as any).release());
    await expect.poll(async()=>a.evaluate(async()=>!((await navigator.locks!.query()).held??[]).some(lock=>lock.name==='sd3.f04.twitch-moment-journal.v1'))).toBe(true);
    await b.getByRole('button',{name:'Vérifier le moment sans publier'}).click();
    await b.getByLabel('Confirmer le moment Twitch').check();
    await b.getByRole('button',{name:'Créer ce moment sur Twitch'}).click();
    await expect.poll(()=>b.getByRole('status').textContent()).toContain('Résultat incertain');
    expect(await b.evaluate(()=>(window as any).calls.filter((c:any)=>c.path.endsWith('/confirm')).length)).toBe(1);
  }finally{await browser.close()}
},30000);
