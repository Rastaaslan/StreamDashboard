import {it,expect} from 'vitest';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

it.skipIf(process.env.SC3_FINAL_BROWSER_TEST!=='1')('F04 Edge 320px: expired preview refuses a Twitch POST if the browser lock callback runs late',async()=>{
  const bundle=await build({stdin:{contents:"import {mountTwitchMoments} from './apps/mobile/control/streamcockpit-twitch-moments.js';window.mountMoments=mountTwitchMoments;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    await page.route('**/*',route=>route.abort());
    await page.route('http://127.0.0.1:38663/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<main id="root"></main>'}));
    await page.goto('http://127.0.0.1:38663/moments');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      const w=window as any;
      w.calls=[];
      w.panel=w.mountMoments(document.querySelector('#root'),{request:async(path:string,body:any,method:string)=>{
        w.calls.push({path,method});
        if(path.endsWith('/preview'))return {schemaVersion:1,kind:'streamcockpit-moment-preview',confirmationId:'643e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5',expiresAt:Date.now()+30_000,draft:body.draft};
        throw Error('NO_PUBLIC_TWITCH_POST_EXPECTED');
      }});
      w.panel.update({online:true,sourceKey:'FIXE',accountKey:'owner'});
      // Still use the browser's REAL Web Locks API. Only simulate a browser
      // suspension between click-time expiry check and the acquired lock callback.
      const nativeLocks=navigator.locks;
      Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(name:string,options:LockOptions,callback:(lock:Lock|null)=>unknown)=>
        nativeLocks.request(name,options,lock=>{
          const originalNow=Date.now,late=originalNow()+60_000;
          Date.now=()=>late;
          try{return callback(lock)}finally{Date.now=originalNow}
        })
      }});
    });
    await page.getByLabel('Type de moment Twitch').selectOption('clip');
    await page.getByRole('button',{name:'Vérifier le moment sans publier'}).click();
    await page.getByLabel('Confirmer le moment Twitch').check();
    await page.getByRole('button',{name:'Créer ce moment sur Twitch'}).click();
    await expect.poll(()=>page.getByRole('status').textContent()).toContain('aucun moment envoyé sur Twitch');
    expect(await page.evaluate(()=>(window as any).calls.map((c:any)=>c.path))).toEqual(['/api/v1/twitch/advanced/moment/preview']);
    expect(await page.evaluate(()=>localStorage.getItem('sd3.f04.twitch-moment-uncertain.v1'))).toBeNull();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
    await page.evaluate(()=>(window as any).panel.destroy());
  }finally{await browser.close()}
},30000);
