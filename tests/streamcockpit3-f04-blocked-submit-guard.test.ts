import {it,expect} from 'vitest';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

it.skipIf(process.env.SC3_FINAL_BROWSER_TEST!=='1')('F04 Edge 320px: corrupt journal forbids even a synthetic form submission and never issues Twitch preview',async()=>{
  const bundle=await build({stdin:{contents:"import {mountTwitchMoments} from './apps/mobile/control/streamcockpit-twitch-moments.js';window.mountMoments=mountTwitchMoments;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    await page.route('**/*',route=>route.abort());
    await page.route('http://127.0.0.1:38678/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main>'}));
    await page.goto('http://127.0.0.1:38678/f04-test');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      const w=window as any;
      localStorage.setItem('sd3.f04.twitch-moment-uncertain.v1','{broken');
      w.calls=[];
      w.panel=w.mountMoments(document.getElementById('root'),{request:async(path:string)=>{w.calls.push(path);return {schemaVersion:1,kind:'streamcockpit-moment-preview',confirmationId:'ab7d9130-cc1e-41b0-82ce-d68b19af994e',expiresAt:Date.now()+30000,draft:{kind:'marker',description:''}}}});
      w.panel.update({sourceKey:'FIXE',accountKey:'owner',online:true});
    });
    expect(await page.getByRole('button',{name:'Vérifier le moment sans publier'}).isDisabled()).toBe(true);
    expect(await page.getByRole('status').innerText()).toContain('Stockage des confirmations Twitch illisible');
    await page.evaluate(()=>document.querySelector('main form')?.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    await page.waitForTimeout(40);
    expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
    expect(await page.getByRole('button',{name:'Créer ce moment sur Twitch'}).isVisible()).toBe(false);
    expect(await page.getByRole('status').innerText()).toContain('Stockage des confirmations Twitch illisible');
    await page.evaluate(()=>(window as any).panel.destroy());
  } finally {await browser.close()}
},30000);

it.skipIf(process.env.SC3_FINAL_BROWSER_TEST!=='1')('F04 Edge 320px: resumed view rechecks late journal corruption even without a storage event',async()=>{
  const bundle=await build({stdin:{contents:"import {mountTwitchMoments} from './apps/mobile/control/streamcockpit-twitch-moments.js';window.mountMoments=mountTwitchMoments;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    await page.route('**/*',route=>route.abort());
    await page.route('http://127.0.0.1:38679/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<main id="root"></main>'}));
    await page.goto('http://127.0.0.1:38679/f04-test');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      const w=window as any;w.calls=[];
      w.panel=w.mountMoments(document.getElementById('root'),{request:async(path:string)=>{w.calls.push(path);throw Error('PREVIEW SHOULD BE BLOCKED')}});
      w.panel.update({sourceKey:'FIXE',accountKey:'owner',online:true});
      // Same-window writes, as after an embedded WebView restore, produce no storage event.
      localStorage.setItem('sd3.f04.twitch-moment-uncertain.v1','{corrupted-after-render');
    });
    expect(await page.getByRole('button',{name:'Vérifier le moment sans publier'}).isDisabled()).toBe(false);
    await page.evaluate(()=>document.querySelector('main form')?.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    await page.waitForTimeout(40);
    expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
    expect(await page.getByRole('status').innerText()).toContain('Stockage des confirmations Twitch illisible');
    expect(await page.getByRole('button',{name:'Vérifier le moment sans publier'}).isDisabled()).toBe(true);
    await page.evaluate(()=>(window as any).panel.destroy());
  } finally {await browser.close()}
},30000);
