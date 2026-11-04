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
    // A real origin is required for WebView localStorage; about:blank would disable safe POST admission.
    await page.route('http://127.0.0.1:38649/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main>'}));
    await page.goto('http://127.0.0.1:38649/moments');
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

it.skipIf(process.env.SC3_FINAL_BROWSER_TEST!=='1')('F04 real Edge: uncertain Twitch request survives reload, stays host/account scoped and is never retried',async()=>{
  const bundle=await build({stdin:{contents:"import {mountTwitchMoments} from './apps/mobile/control/streamcockpit-twitch-moments.js';window.mountMoments=mountTwitchMoments;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    await page.route('**/*',r=>r.abort());
    await page.route('http://127.0.0.1:38650/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<main id="root"></main>'}));
    const mount=async()=>{
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      await page.evaluate(()=>{
        const w=window as any;w.calls=[];w.panel=w.mountMoments(document.querySelector('#root'),{request:async(path:string,body:any,method:string)=>{
          w.calls.push({path,method});
          if(path.endsWith('/preview'))return {schemaVersion:1,kind:'streamcockpit-moment-preview',confirmationId:'643e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5',expiresAt:Date.now()+30_000,draft:body.draft};
          if(method==='GET')return {schemaVersion:1,kind:'streamcockpit-moment-status',status:'not_found_at_read',retryable:false};
          throw Error('PRIVATE');
        }});w.panel.update({online:true,sourceKey:'FIXE',accountKey:'owner'});
      });
    };
    await page.goto('http://127.0.0.1:38650/moments');await mount();
    await page.getByLabel('Type de moment Twitch').selectOption('clip');
    await page.getByRole('button',{name:'Vérifier le moment sans publier'}).click();
    await page.getByLabel('Confirmer le moment Twitch').check();
    await page.getByRole('button',{name:'Créer ce moment sur Twitch'}).click();
    await expect.poll(()=>page.getByRole('status').textContent()).toContain('Résultat incertain');
    expect(await page.evaluate(()=>[...Object.values(window.localStorage)].join(' '))).not.toContain('PRIVATE');
    expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.path.endsWith('/confirm')).length)).toBe(1);
    await page.reload();await mount();
    await expect.poll(()=>page.getByRole('status').textContent()).toContain('Résultat incertain conservé après rechargement');
    expect(await page.getByRole('button',{name:'Vérifier le moment sans publier'}).isDisabled()).toBe(true);
    await page.getByRole('button',{name:'Consulter le journal FIXE sans renvoyer'}).click();
    await expect.poll(()=>page.getByRole('status').textContent()).toContain('Aucune entrée trouvée');
    expect(await page.evaluate(()=>(window as any).calls.map((c:any)=>c.method))).toEqual(['GET']);
    await page.evaluate(()=>(window as any).panel.update({online:true,sourceKey:'autre-FIXE',accountKey:'owner'}));
    expect(await page.getByRole('button',{name:'Vérifier le moment sans publier'}).isEnabled()).toBe(true);
    await page.evaluate(()=>(window as any).panel.update({online:true,sourceKey:'FIXE',accountKey:'other-owner'}));
    expect(await page.getByRole('button',{name:'Vérifier le moment sans publier'}).isEnabled()).toBe(true);
    await page.evaluate(()=>(window as any).panel.update({online:true,sourceKey:'FIXE',accountKey:'owner'}));
    expect(await page.getByRole('button',{name:'Vérifier le moment sans publier'}).isDisabled()).toBe(true);
    await page.getByRole('button',{name:'J’ai vérifié ce moment dans Twitch'}).click();
    await expect.poll(()=>page.getByRole('button',{name:'Vérifier le moment sans publier'}).isEnabled()).toBe(true);
    await page.reload();await mount();
    expect(await page.getByRole('button',{name:'Vérifier le moment sans publier'}).isEnabled()).toBe(true);
    expect(await page.getByRole('button',{name:'Consulter le journal FIXE sans renvoyer'}).isVisible()).toBe(false);
    // Storage denial must happen BEFORE a POST, not after a public Twitch operation.
    await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('QUOTA')};(window as any).originalStorageSetItem=original});
    await page.getByRole('button',{name:'Vérifier le moment sans publier'}).click();
    await page.getByLabel('Confirmer le moment Twitch').check();
    await page.getByRole('button',{name:'Créer ce moment sur Twitch'}).click();
    await expect.poll(()=>page.getByRole('status').textContent()).toContain('aucun moment envoyé');
    expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.path.endsWith('/confirm')).length)).toBe(0);
  }finally{await browser.close()}
},30000);

it.skipIf(process.env.SC3_FINAL_BROWSER_TEST!=='1')('F04 real Edge 320px: corrupted pending journal shows a read-only block across reload, never a Twitch POST',async()=>{
  const bundle=await build({stdin:{contents:"import {mountTwitchMoments} from './apps/mobile/control/streamcockpit-twitch-moments.js';window.mountMoments=mountTwitchMoments;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    await page.route('**/*',route=>route.abort());
    await page.route('http://127.0.0.1:38651/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<main id="root"></main>'}));
    const mount=async()=>{
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      await page.evaluate(()=>{
        const w=window as any;w.calls=[];
        w.panel=w.mountMoments(document.querySelector('#root'),{request:async(...args:any[])=>{w.calls.push(args);throw Error('PROVIDER_MUST_NOT_BE_CALLED')}});
        w.panel.update({online:true,sourceKey:'FIXE',accountKey:'owner'});
      });
    };
    await page.goto('http://127.0.0.1:38651/moments');
    await page.evaluate(()=>localStorage.setItem('sd3.f04.twitch-moment-uncertain.v1','{bad-json'));await mount();
    await expect.poll(()=>page.getByRole('status').textContent()).toContain('Stockage des confirmations Twitch illisible');
    expect(await page.getByRole('button',{name:'Vérifier le moment sans publier'}).isDisabled()).toBe(true);
    expect(await page.getByRole('button',{name:'Consulter le journal FIXE sans renvoyer'}).isVisible()).toBe(false);
    expect(await page.evaluate(()=>[localStorage.getItem('sd3.f04.twitch-moment-uncertain.v1'),(window as any).calls.length])).toEqual(['{bad-json',0]);
    await page.reload();await mount();
    await expect.poll(()=>page.getByRole('status').textContent()).toContain('Stockage des confirmations Twitch illisible');
    expect(await page.getByRole('button',{name:'Vérifier le moment sans publier'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>[localStorage.getItem('sd3.f04.twitch-moment-uncertain.v1'),(window as any).calls.length])).toEqual(['{bad-json',0]);
    await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'))});
    await expect.poll(()=>page.getByRole('status').textContent()).toContain('Stockage des confirmations Twitch illisible');
    await page.evaluate(()=>(window as any).panel.update({online:true,sourceKey:'OTHER',accountKey:'owner'}));
    expect(await page.getByRole('button',{name:'Vérifier le moment sans publier'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>[localStorage.getItem('sd3.f04.twitch-moment-uncertain.v1'),(window as any).calls.length])).toEqual(['{bad-json',0]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
    await page.evaluate(()=>(window as any).panel.destroy());
  }finally{await browser.close()}
},30000);


it.skipIf(process.env.SC3_FINAL_BROWSER_TEST!=='1')('F04 real Edge 320px: partially corrupt journal exposes one scoped GET-only receipt after reload, never repairs or posts',async()=>{
  const bundle=await build({stdin:{contents:"import {mountTwitchMoments} from './apps/mobile/control/streamcockpit-twitch-moments.js';window.mountMoments=mountTwitchMoments;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    await page.route('**/*',r=>r.abort());
    await page.route('http://127.0.0.1:38654/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<main id="root"></main>'}));
    await page.goto('http://127.0.0.1:38654/moments');
    const original=await page.evaluate(()=>{
      const raw=JSON.stringify({version:1,rows:[
        {source:'FIXE',account:'owner',id:'643e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5',kind:'clip',createdAt:Date.now()},
        {source:'OTHER',account:'another',id:'malformed',kind:'marker',createdAt:Date.now()},
      ]});localStorage.setItem('sd3.f04.twitch-moment-uncertain.v1',raw);return raw;
    });
    const mount=async()=>{
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      await page.evaluate(()=>{
        const w=window as any;w.calls=[];w.panel=w.mountMoments(document.getElementById('root'),{request:async(path:string,_body:any,method:string)=>{
          w.calls.push({path,method});
          if(method==='GET')return {schemaVersion:1,kind:'streamcockpit-moment-status',retryable:false,status:'journal_observed',momentKind:'clip'};
          throw Error('NO_POST_OR_PREVIEW_ALLOWED');
        }});w.panel.update({online:true,sourceKey:'FIXE',accountKey:'owner'});
      });
    };
    await mount();
    for(let n=0;n<2;n++){
      await expect.poll(()=>page.getByRole('status').textContent()).toContain('Stockage des confirmations Twitch illisible');
      expect(await page.getByRole('button',{name:'Vérifier le moment sans publier'}).isDisabled()).toBe(true);
      expect(await page.getByRole('button',{name:'J’ai vérifié ce moment dans Twitch'}).isVisible()).toBe(false);
      const inspect=page.getByRole('button',{name:'Consulter le journal FIXE sans renvoyer'});
      expect(await inspect.isVisible()).toBe(true);await inspect.click();
      await expect.poll(()=>page.getByRole('status').textContent()).toContain('Stockage local toujours bloqué');
      expect(await page.evaluate(()=>localStorage.getItem('sd3.f04.twitch-moment-uncertain.v1'))).toBe(original);
      expect(await page.evaluate(()=>(window as any).calls.map((c:any)=>c.method))).toEqual(['GET']);
      if(n===0){await page.reload();await mount()}
    }
    await page.evaluate(()=>(window as any).panel.update({online:true,sourceKey:'FIXE',accountKey:'other'}));
    expect(await page.getByRole('button',{name:'Consulter le journal FIXE sans renvoyer'}).isVisible()).toBe(false);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
    expect(await page.evaluate(()=>localStorage.getItem('sd3.f04.twitch-moment-uncertain.v1'))).toBe(original);
  }finally{await browser.close()}
},30000);

it.skipIf(process.env.SC3_FINAL_BROWSER_TEST!=='1')('F04 real Edge 320px: explicit local forensic backup retains malformed bytes, without any POST or journal mutation',async()=>{
  const bundle=await build({stdin:{contents:"import {mountTwitchMoments} from './apps/mobile/control/streamcockpit-twitch-moments.js';window.mountMoments=mountTwitchMoments;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true,acceptDownloads:true});
    await page.route('**/*',r=>r.abort());
    await page.route('http://127.0.0.1:38659/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<main id="root"></main>'}));
    await page.goto('http://127.0.0.1:38659/moments');
    const raw='{truncated-json private-raw-MUST-NOT-APPEAR-ON-PAGE';
    await page.evaluate(value=>localStorage.setItem('sd3.f04.twitch-moment-uncertain.v1',value),raw);
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      const w=window as any;w.calls=[];w.panel=w.mountMoments(document.getElementById('root'),{request:async(...args:any[])=>{w.calls.push(args);throw Error('NO_PROVIDER_CALL')}});
      w.panel.update({online:true,sourceKey:'FIXE',accountKey:'owner'});
    });
    const backup=page.getByRole('button',{name:'Exporter une copie locale du journal (confidentiel)'});
    expect(await backup.isVisible()).toBe(true);
    expect(await page.locator('main').textContent()).not.toContain('private-raw-MUST');
    expect(await page.getByRole('button',{name:'Vérifier le moment sans publier'}).isDisabled()).toBe(true);
    const downloaded=page.waitForEvent('download');await backup.click();
    const file=await downloaded;
    expect(file.suggestedFilename()).toMatch(/^streamcockpit-f04-journal-\d{8}\.txt$/);
    expect(readFileSync(await file.path(),'utf8')).toBe(raw);
    expect(await page.evaluate(()=>localStorage.getItem('sd3.f04.twitch-moment-uncertain.v1'))).toBe(raw);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(0);
    expect(await page.getByRole('button',{name:'Vérifier le moment sans publier'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
  }finally{await browser.close()}
},30000);
