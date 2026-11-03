import {expect,it} from 'vitest';
import {build} from 'esbuild';
import {chromium,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';

async function withPage(run:(page:Page)=>Promise<void>){
  const bundle=await build({stdin:{
    contents:"import {mountTwitchPredictionEnd} from './apps/mobile/control/streamcockpit-twitch-prediction-end.js';globalThis.mountEnd=mountTwitchPredictionEnd;",
    resolveDir:process.cwd(),
  },bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    const external:string[]=[];
    await page.route('**/*',route=>{external.push(route.request().url());return route.abort();});
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root" style="width:100%;min-width:0;box-sizing:border-box"></main>');
    await page.addStyleTag({content:readFileSync('apps/mobile/control/streamcockpit-mobile-v2.css','utf8')});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      const w=window as any;
      w.calls=[];w.mode='normal';w.currentAction='RESOLVED';w.lateReceipt=undefined;
      w.panel=w.mountEnd(document.getElementById('root'),{request:async(path:string,body:any,method:string,source:string)=>{
        w.calls.push({path,body,method,source});
        if(path.endsWith('/inspect')){
          if(w.mode==='down')throw Error('SECRET_PROVIDER_DOWN');
          return {schemaVersion:1,kind:'streamcockpit-prediction-end-inspection',
            providerStatus:w.mode==='active'?'active':'locked',
            outcomes:[{id:'vote-111',title:'Option A'},{id:'vote-222',title:'Option B'}],
            canResolve:w.mode!=='active',canCancel:true,mutationPerformed:false};
        }
        if(path.endsWith('/preview')){
          if(w.mode==='refused')throw Error('PRIVATE_PREVIEW_ERR');
          w.currentAction=body.action;
          return {schemaVersion:1,kind:'streamcockpit-prediction-end-preview',
            confirmationId:'11111111-1111-4111-8111-111111111111',
            action:body.action.toLowerCase(),winnerId:body.winnerId,expiresAt:Date.now()+25000};
        }
        if(w.mode==='lost')throw Error('PRIVATE_PATCH_SECRET');
        if(w.mode==='late')return new Promise(resolve=>{w.lateReceipt=()=>resolve({
          schemaVersion:1,kind:'streamcockpit-prediction-end-confirmation',
          predictionId:'pred-777',status:'resolved',
        });});
        return {schemaVersion:1,kind:'streamcockpit-prediction-end-confirmation',
          predictionId:'pred-777',status:w.currentAction.toLowerCase()};
      }});
      w.panel.update({sourceKey:'FIXE',accountKey:'owner',online:true});
    });
    await run(page);
    expect(external).toEqual([]);
    await page.evaluate(()=>(window as any).panel.destroy());
  }finally{await browser.close();}
}
async function inspect(page:Page){
  await page.getByRole('button',{name:'Inspecter la prédiction sur FIXE'}).click();
  await expect.poll(()=>page.getByRole('button',{name:'Prévisualiser la fin Twitch'}).isVisible()).toBe(true);
}
async function approve(page:Page){
  await page.getByRole('button',{name:'Prévisualiser la fin Twitch'}).click();
  await expect.poll(()=>page.getByRole('checkbox',{name:/fin publique et irréversible/}).isVisible()).toBe(true);
  await page.getByRole('checkbox',{name:/fin publique et irréversible/}).check();
  await page.getByRole('button',{name:'Confirmer la fin de la prédiction Twitch'}).click();
}
it.skipIf(process.env.TWITCH_PREDICTION_END_BROWSER_TEST!=='1')(
  'F08 real Edge touch 320px resolves exact winning outcome with explicit consent',async()=>withPage(async page=>{
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(0);
    await inspect(page);
    await page.getByRole('combobox',{name:'Résultat gagnant'}).selectOption('vote-222');
    await page.getByRole('button',{name:'Prévisualiser la fin Twitch'}).click();
    expect(await page.getByRole('button',{name:'Confirmer la fin de la prédiction Twitch'}).isDisabled()).toBe(true);
    await page.getByRole('checkbox',{name:/fin publique et irréversible/}).check();
    await page.getByRole('button',{name:'Confirmer la fin de la prédiction Twitch'}).click();
    await expect.poll(()=>page.getByText(/Fin Twitch resolved confirmée/).isVisible()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.map((v:any)=>[v.path,v.method]))).toEqual([
      ['/api/v1/twitch/advanced/prediction/end/inspect','GET'],
      ['/api/v1/twitch/advanced/prediction/end/preview','POST'],
      ['/api/v1/twitch/advanced/prediction/end/confirm','POST'],
    ]);
    const calls=await page.evaluate(()=>(window as any).calls);
    expect(calls[1].body).toEqual({action:'RESOLVED',winnerId:'vote-222'});
    expect(await page.getByRole('button',{name:'Inspecter la prédiction sur FIXE'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
  }),30000);
it.skipIf(process.env.TWITCH_PREDICTION_END_BROWSER_TEST!=='1')(
  'F08 active prediction offers cancellation only, never a false resolution',async()=>withPage(async page=>{
    await page.evaluate(()=>(window as any).mode='active');
    await inspect(page);
    expect(await page.getByRole('combobox',{name:'Résultat gagnant'}).isVisible()).toBe(false);
    await approve(page);
    await expect.poll(()=>page.getByText(/Fin Twitch canceled confirmée/).isVisible()).toBe(true);
    const calls=await page.evaluate(()=>(window as any).calls);
    expect(calls[1].body).toEqual({action:'CANCELED'});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
  }),30000);
it.skipIf(process.env.TWITCH_PREDICTION_END_BROWSER_TEST!=='1')(
  'F08 provider or preview error cannot expose public consent or secrets',async()=>withPage(async page=>{
    await page.evaluate(()=>(window as any).mode='down');
    await page.getByRole('button',{name:'Inspecter la prédiction sur FIXE'}).click();
    await expect.poll(()=>page.getByRole('status').last().textContent()).toContain('indisponible');
    expect(await page.getByRole('button',{name:'Prévisualiser la fin Twitch'}).isVisible()).toBe(false);
    await page.evaluate(()=>(window as any).mode='normal');
    await inspect(page);
    await page.evaluate(()=>(window as any).mode='refused');
    await page.getByRole('button',{name:'Prévisualiser la fin Twitch'}).click();
    await expect.poll(()=>page.getByRole('status').last().textContent()).toContain('refusée');
    expect(await page.getByRole('checkbox',{name:/fin publique/}).isVisible()).toBe(false);
    expect(await page.getByRole('status').last().textContent()).not.toContain('PRIVATE');
  }),30000);
it.skipIf(process.env.TWITCH_PREDICTION_END_BROWSER_TEST!=='1')(
  'F08 lost PATCH or source change never replays an uncertain public end action',async()=>withPage(async page=>{
    await inspect(page);
    await page.evaluate(()=>(window as any).mode='late');
    await approve(page);
    await expect.poll(()=>page.evaluate(()=>typeof (window as any).lateReceipt)).toBe('function');
    await page.evaluate(()=>{const w=window as any;
      w.panel.update({sourceKey:'OTHER',accountKey:'owner',online:true});
      w.lateReceipt();
    });
    await page.waitForTimeout(80);
    expect(await page.getByRole('button',{name:'Inspecter la prédiction sur FIXE'}).isDisabled()).toBe(true);
    expect(await page.getByText(/Fin Twitch resolved confirmée/).count()).toBe(0);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(3);
  }),30000);
it.skipIf(process.env.TWITCH_PREDICTION_END_BROWSER_TEST!=='1')(
  'F08 missing PATCH acknowledgement disables reattempt through reconnect',async()=>withPage(async page=>{
    await inspect(page);
    await page.evaluate(()=>(window as any).mode='lost');
    await approve(page);
    await expect.poll(()=>page.getByRole('status').last().textContent()).toContain('incertain');
    await page.evaluate(()=>{const w=window as any;
      w.panel.update({sourceKey:'FIXE',accountKey:'owner',online:false});
      w.panel.update({sourceKey:'FIXE',accountKey:'owner',online:true});
    });
    expect(await page.getByRole('button',{name:'Inspecter la prédiction sur FIXE'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(3);
    expect(await page.getByRole('status').last().textContent()).not.toContain('PRIVATE');
  }),30000);
