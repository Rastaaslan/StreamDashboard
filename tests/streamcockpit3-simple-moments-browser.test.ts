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
        if(path.includes('/status/'))return {schemaVersion:1,kind:'streamcockpit-moment-status',status:'not_found_at_read',retryable:false};
        if(w.lost)throw Error('PRIVATE');
        return {schemaVersion:1,kind:'streamcockpit-moment-confirmation',momentKind:w.kind,status:w.kind==='clip'?'accepted':'confirmed',id:'Safe',journal:'recorded',...(w.kind==='clip'?{editUrl:w.badClipUrl??'https://clips.twitch.tv/Safe/edit'}:{})};
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
    const inspect=page.getByRole('button',{name:'Consulter le journal FIXE sans renvoyer'});
    await expect.poll(()=>inspect.isVisible()).toBe(true);
    await inspect.click();
    await expect.poll(()=>page.getByRole('status').textContent()).toContain('Aucune entrée trouvée');
    expect(await page.getByRole('button',{name:'Vérifier le moment sans publier'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.method==='POST').length)).toBe(6);
    expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.method==='GET').length)).toBe(1);
    expect(await page.locator('main').textContent()).not.toContain('PRIVATE');
    // Even if a malformed provider receipt crossed the server boundary, a client
    // must not turn an unrelated/redirectable URL into a trusted Twitch edit link.
    for(const badUrl of [
      'https://clips.twitch.tv/Another/edit',
      'https://clips.twitch.tv/Safe/edit?redirect=1',
      'https://clips.twitch.tv:8443/Safe/edit',
      'https://clips.twitch.tv/Safe/edit#fragment',
    ]){
      await page.getByRole('button',{name:'J’ai vérifié ce moment dans Twitch'}).click();
      await page.evaluate(url=>{const w=window as any;w.lost=false;w.badClipUrl=url},badUrl);
      await page.getByLabel('Type de moment Twitch').selectOption('clip');
      await page.getByRole('button',{name:'Vérifier le moment sans publier'}).click();
      await page.getByLabel('Confirmer le moment Twitch').check();
      await page.getByRole('button',{name:'Créer ce moment sur Twitch'}).click();
      await expect.poll(()=>page.getByRole('status').textContent()).toContain('Résultat incertain');
      expect(await page.getByRole('link',{name:'Ouvrir le clip dans Twitch'}).isVisible()).toBe(false);
      expect(await page.getByRole('button',{name:'Vérifier le moment sans publier'}).isDisabled()).toBe(true);
      await expect.poll(()=>page.getByRole('button',{name:'Consulter le journal FIXE sans renvoyer'}).isVisible()).toBe(true);
    }
    await page.getByRole('button',{name:'Consulter le journal FIXE sans renvoyer'}).click();
    await expect.poll(()=>page.getByRole('status').textContent()).toContain('Aucune entrée trouvée');
    expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.method==='GET').length)).toBe(2);
    await page.evaluate(()=>(window as any).panel.destroy());
  }finally{await browser.close()}
},30000);
