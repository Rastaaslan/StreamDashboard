import {it,expect} from 'vitest';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
it.skipIf(process.env.SC3_FINAL_BROWSER_TEST!=='1')('F04 real Edge 320px: marker/clip consent, truthful async status, safe link and uncertainty',async()=>{
  const bundle=await build({stdin:{contents:"import {mountTwitchMoments} from './apps/mobile/control/streamcockpit-twitch-moments.js';window.mountMoments=mountTwitchMoments;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    await page.route('**/*',r=>r.abort());
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main>');
    await page.addStyleTag({content:readFileSync('apps/mobile/control/streamcockpit-mobile-v2.css','utf8')});await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      const w=window as any;w.calls=[];w.lost=false;
      w.panel=w.mountMoments(document.getElementById('root'),{request:async(path:string,body:any,method:string,source:string)=>{
        w.calls.push({path,body,method,source});
        if(path.endsWith('/preview')){w.kind=body.draft.kind;return {schemaVersion:1,kind:'streamcockpit-moment-preview',confirmationId:'643e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5',expiresAt:Date.now()+30_000,draft:body.draft}}
        if(w.lost)throw Error('PRIVATE');
        return {schemaVersion:1,kind:'streamcockpit-moment-confirmation',momentKind:w.kind,status:w.kind==='clip'?'accepted':'confirmed',id:'safe',journal:'recorded',...(w.kind==='clip'?{editUrl:'https://clips.twitch.tv/Safe/edit'}:{})};
      }});w.panel.update({sourceKey:'FIXE',accountKey:'owner',online:true});
    });
    for(const kind of ['marker','clip']){
      await page.getByLabel('Type de moment Twitch').selectOption(kind);await page.getByLabel('Description du moment').fill('Important');
      await page.getByRole('button',{name:'Vérifier le moment sans publier'}).click();
      const submit=page.getByRole('button',{name:'Créer ce moment sur Twitch'});
      await expect.poll(()=>submit.isVisible()).toBe(true);expect(await submit.isDisabled()).toBe(true);
      await page.getByLabel('Confirmer le moment Twitch').check();await submit.click();
      await expect.poll(()=>page.getByRole('status').textContent()).toContain(kind==='clip'?'disponibilité de la vidéo à vérifier':'Marqueur confirmé');
      if(kind==='clip')expect(await page.getByRole('link',{name:'Ouvrir le clip dans Twitch'}).getAttribute('href')).toBe('https://clips.twitch.tv/Safe/edit');
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
    await page.getByRole('button',{name:'Vérifier le moment sans publier'}).click();await page.getByLabel('Confirmer le moment Twitch').check();
    await page.evaluate(()=>(window as any).lost=true);await page.getByRole('button',{name:'Créer ce moment sur Twitch'}).click();
    await expect.poll(()=>page.getByRole('status').textContent()).toContain('Résultat incertain');
    await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'))});
    expect(await page.getByRole('button',{name:'Vérifier le moment sans publier'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(6);
    expect(await page.locator('main').textContent()).not.toContain('PRIVATE');
    await page.evaluate(()=>(window as any).panel.destroy());
  }finally{await browser.close()}
},30000);
