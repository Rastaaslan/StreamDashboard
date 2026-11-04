import {it,expect} from 'vitest';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

// A second tab can create then clear an uncertain receipt before this tab's
// storage event is dispatched. A previously consented preview must not survive.
it.skipIf(process.env.SC3_FINAL_BROWSER_TEST!=='1')('F04 Edge two tabs: short-lived external receipt invalidates a stale Twitch preview without POST',async()=>{
  const bundle=await build({stdin:{
    contents:"import {mountTwitchMoments} from './apps/mobile/control/streamcockpit-twitch-moments.js';window.mountMoments=mountTwitchMoments;",
    resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const origin='http://127.0.0.1:38678';
    const context=await browser.newContext({viewport:{width:320,height:720},hasTouch:true});
    await context.route('**/*',r=>r.abort());
    await context.route(origin+'/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<main id="root"></main>'}));
    const a=await context.newPage(),b=await context.newPage();
    await a.goto(origin+'/moments');await b.goto(origin+'/moments');
    await a.addScriptTag({content:bundle.outputFiles[0].text});
    await a.evaluate(()=>{
      const w=window as any;w.calls=[];
      w.panel=w.mountMoments(document.getElementById('root'),{request:async(path:string,body:any,method:string)=>{
        w.calls.push({path,method});
        if(path.endsWith('/preview'))return {schemaVersion:1,kind:'streamcockpit-moment-preview',confirmationId:'643e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5',expiresAt:Date.now()+30_000,draft:body.draft};
        throw Error('NO_TWITCH_POST_ALLOWED');
      }});
      w.panel.update({online:true,sourceKey:'FIXE',accountKey:'owner'});
    });
    await a.getByRole('button',{name:'Vérifier le moment sans publier'}).click();
    await a.getByLabel('Confirmer le moment Twitch').check();
    expect(await a.getByRole('button',{name:'Créer ce moment sur Twitch'}).isEnabled()).toBe(true);
    // Both changes occur in one synchronous task, so the receiving tab may only
    // observe the final (empty) storage, even though an outside POST happened.
    await b.evaluate(()=>{
      const key='sd3.f04.twitch-moment-uncertain.v1';
      localStorage.setItem(key,JSON.stringify({version:1,rows:[{
        source:'FIXE',account:'owner',id:'743e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5',kind:'clip',createdAt:Date.now(),
      }]}));
      localStorage.removeItem(key);
    });
    await expect.poll(()=>a.getByRole('status').textContent()).toContain('autre fenêtre');
    expect(await a.getByRole('button',{name:'Créer ce moment sur Twitch'}).isVisible()).toBe(false);
    expect(await a.getByRole('button',{name:'Vérifier le moment sans publier'}).isEnabled()).toBe(true);
    expect(await a.evaluate(()=>(window as any).calls.filter((c:any)=>c.path.endsWith('/confirm')).length)).toBe(0);
    expect(await a.evaluate(()=>localStorage.getItem('sd3.f04.twitch-moment-uncertain.v1'))).toBeNull();
    await a.evaluate(()=>(window as any).panel.destroy());
  }finally{await browser.close()}
},30000);
