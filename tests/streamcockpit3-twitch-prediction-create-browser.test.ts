import { build } from 'esbuild';
import { chromium, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

async function browserTest(run:(page:Page)=>Promise<void>) {
  const bundle=await build({stdin:{
    contents:"import {mountTwitchPredictionCreate} from './apps/mobile/control/streamcockpit-twitch-prediction-create.js'; globalThis.mountCreate=mountTwitchPredictionCreate;",
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
      w.calls=[];w.mode='ok';w.release=undefined;
      w.create=w.mountCreate(document.getElementById('root'),{
        request:async(path:string,body:any,method:string,source:string)=>{
          w.calls.push({path,body,method,source});
          if(path.endsWith('/preview') && w.mode==='host-fence')throw Object.assign(new Error('PREDICTION_PRECONDITION'),{status:409});
          if(path.endsWith('/preview'))return {
            schemaVersion:1,kind:'streamcockpit-prediction-preview',
            confirmationId:'11111111-1111-4111-8111-111111111111',
            expiresAt:Date.now()+30000,draft:body.draft,
          };
          if(w.mode==='lost')throw Object.assign(new Error('PRIVATE_SECRET'),{status:503});
          if(w.mode==='late')return new Promise(resolve=>{w.release=()=>resolve({
            schemaVersion:1,kind:'streamcockpit-prediction-confirmation',
            status:'confirmed',predictionId:'pred-777',
          });});
          return {schemaVersion:1,kind:'streamcockpit-prediction-confirmation',
            status:'confirmed',predictionId:'pred-777'};
        },
      });
      w.create.update({sourceKey:'FIXE',accountKey:'owner',online:true});
    });
    await run(page);
    expect(external).toEqual([]);
    await page.evaluate(()=>(window as any).create.destroy());
  } finally {await browser.close();}
}
async function draft(page:Page){
  await page.getByRole('textbox',{name:'Question de la prédiction'}).fill('Quel boss ?');
  await page.getByRole('textbox',{name:/Issues/}).fill('A\nB');
  await page.getByRole('button',{name:'Prévisualiser la prédiction'}).click();
  await expect.poll(()=>page.getByText('Prévisualisation seulement. Aucune prédiction créée.').isVisible()).toBe(true);
}
it.skipIf(process.env.TWITCH_PREDICTION_CREATE_BROWSER_TEST!=='1')(
  'F08 real Edge 320px requires explicit preview, checkbox and unique publication',async()=>browserTest(async page=>{
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(0);
    await draft(page);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(1);
    expect(await page.getByRole('button',{name:'Confirmer la création sur Twitch'}).isDisabled()).toBe(true);
    await page.getByRole('checkbox',{name:/publication immédiate/}).check();
    await page.getByRole('button',{name:'Confirmer la création sur Twitch'}).click();
    await expect.poll(()=>page.getByText(/Création acceptée par Twitch/).isVisible()).toBe(true);
    expect(await page.getByRole('button',{name:'Prévisualiser la prédiction'}).isDisabled()).toBe(true);
    expect(await page.getByText(/journal FIXE interdit une nouvelle création/).isVisible()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.map((x:any)=>x.path))).toEqual([
      '/api/v1/twitch/advanced/prediction/preview','/api/v1/twitch/advanced/prediction/confirm',
    ]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
  }),30000);
it.skipIf(process.env.TWITCH_PREDICTION_CREATE_BROWSER_TEST!=='1')(
  'F08 lost Twitch POST receipt remains blocked even AFTER manual Twitch acknowledgement',async()=>browserTest(async page=>{
    await page.evaluate(()=>(window as any).mode='lost');
    await draft(page);
    await page.getByRole('checkbox',{name:/publication immédiate/}).check();
    await page.getByRole('button',{name:'Confirmer la création sur Twitch'}).click();
    await expect.poll(()=>page.getByText(/Publication potentiellement effectuée/).isVisible()).toBe(true);
    expect(await page.getByRole('button',{name:'Prévisualiser la prédiction'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
    await page.getByRole('button',{name:/consulté Twitch/}).click();
    expect(await page.getByText(/FIXE reste bloqué/).isVisible()).toBe(true);
    expect(await page.getByRole('button',{name:'Prévisualiser la prédiction'}).isDisabled()).toBe(true);
    await page.evaluate(()=>{const w=window as any;w.create.update({sourceKey:'FIXE',accountKey:'owner',online:false});w.create.update({sourceKey:'FIXE',accountKey:'owner',online:true});});
    expect(await page.getByRole('button',{name:'Prévisualiser la prédiction'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
  }),30000);
it.skipIf(process.env.TWITCH_PREDICTION_CREATE_BROWSER_TEST!=='1')(
  'F08 changing host during in-flight POST keeps uncertain state and ignores delayed receipt',async()=>browserTest(async page=>{
    await draft(page);
    await page.evaluate(()=>(window as any).mode='late');
    await page.getByRole('checkbox',{name:/publication immédiate/}).check();
    await page.getByRole('button',{name:'Confirmer la création sur Twitch'}).click();
    await expect.poll(()=>page.evaluate(()=>typeof (window as any).release)).toBe('function');
    await page.evaluate(()=>{const w=window as any;w.create.update({sourceKey:'OTHER',accountKey:'owner',online:true});w.release();});
    await expect.poll(()=>page.getByText(/Résultat potentiellement public et incertain/).isVisible()).toBe(true);
    expect(await page.getByRole('button',{name:'Prévisualiser la prédiction'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
    expect(await page.getByText(/Création acceptée par Twitch/).count()).toBe(0);
  }),30000);

it.skipIf(process.env.TWITCH_PREDICTION_CREATE_BROWSER_TEST!=='1')(
  'F08 detached view during POST does not unlock when reattached with unchanged host',async()=>browserTest(async page=>{
    await draft(page);
    await page.evaluate(()=>(window as any).mode='late');
    await page.getByRole('checkbox',{name:/publication immédiate/}).check();
    await page.getByRole('button',{name:'Confirmer la création sur Twitch'}).click();
    await expect.poll(()=>page.evaluate(()=>typeof (window as any).release)).toBe('function');
    await page.evaluate(()=>{
      const w=window as any;w.oldRoot=document.getElementById('root');
      w.oldRoot.remove();w.release();
    });
    await page.waitForTimeout(40);
    await page.evaluate(()=>{
      const w=window as any;document.body.append(w.oldRoot);
      w.create.update({sourceKey:'FIXE',accountKey:'owner',online:true});
    });
    await expect.poll(()=>page.getByText(/Reçu inconnu après publication possible/).isVisible()).toBe(true);
    expect(await page.getByRole('button',{name:'Prévisualiser la prédiction'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
  }),30000);

it.skipIf(process.env.TWITCH_PREDICTION_CREATE_BROWSER_TEST!=='1')(
  'F08 fresh view reports persisted FIXE fence instead of offering automatic retry',async()=>browserTest(async page=>{
    await page.evaluate(()=>(window as any).mode='host-fence');
    await page.getByRole('textbox',{name:'Question de la prédiction'}).fill('Quel boss ?');
    await page.getByRole('textbox',{name:/Issues/}).fill('A\nB');
    await page.getByRole('button',{name:'Prévisualiser la prédiction'}).click();
    await expect.poll(()=>page.getByText(/réservation conservée sur le FIXE/).isVisible()).toBe(true);
    expect(await page.getByRole('button',{name:'Confirmer la création sur Twitch'}).isVisible()).toBe(false);
    expect(await page.evaluate(()=>(window as any).calls.map((x:any)=>x.path))).toEqual([
      '/api/v1/twitch/advanced/prediction/preview',
    ]);
  }),30000);
