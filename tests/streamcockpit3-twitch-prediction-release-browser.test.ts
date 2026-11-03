import { build } from 'esbuild';
import { chromium, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

async function withPage(run:(page:Page)=>Promise<void>) {
  const bundle=await build({stdin:{
    contents:"import {mountTwitchPredictionRelease} from './apps/mobile/control/streamcockpit-twitch-prediction-release.js'; globalThis.mountRelease=mountTwitchPredictionRelease;",
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
      w.calls=[];w.mode='terminal';w.finishConfirm=undefined;
      w.release=w.mountRelease(document.getElementById('root'),{
        request:async(path:string,body:any,method:string,source:string)=>{
          w.calls.push({path,body,method,source});
          if(path.endsWith('/reconcile')){
            if(w.mode==='down')throw Object.assign(new Error('SECRET_123'),{status:503});
            return {schemaVersion:1,kind:'streamcockpit-prediction-reconciliation',
              reservation:w.mode==='absent'?'absent':'confirmed',
              providerStatus:w.mode==='active'?'active':w.mode==='absent'?'unchecked':'resolved',
              unlockAvailable:false,manualReleasePreviewPossible:w.mode==='terminal'||w.mode==='late'};
          }
          if(path.endsWith('/preview'))return {schemaVersion:1,
            kind:'streamcockpit-prediction-release-preview',
            confirmationId:'11111111-1111-4111-8111-111111111111',
            expiresAt:Date.now()+30000,providerStatus:'resolved'};
          if(w.mode==='late')return new Promise(resolve=>{w.finishConfirm=()=>resolve({
            schemaVersion:1,kind:'streamcockpit-prediction-release-confirmed',
            released:true,providerStatus:'resolved',
          });});
          if(w.mode==='lost')throw Object.assign(new Error('PRIVATE_SECRET'),{status:503});
          return {schemaVersion:1,kind:'streamcockpit-prediction-release-confirmed',
            released:true,providerStatus:'resolved'};
        },
      });
      w.release.update({sourceKey:'FIXE',accountKey:'owner',online:true});
    });
    await run(page);
    expect(external).toEqual([]);
    await page.evaluate(()=>(window as any).release.destroy());
  } finally {await browser.close();}
}
async function inspect(page:Page) {
  await page.getByRole('button',{name:'Vérifier la réservation sur FIXE'}).click();
  await expect.poll(()=>page.getByRole('status').textContent()).not.toContain('Lecture explicite');
}
async function preview(page:Page) {
  await inspect(page);
  await page.getByRole('button',{name:'Préparer la libération locale'}).click();
  await expect.poll(()=>page.getByText('Prévisualisation reçue. Aucune réservation libérée.').isVisible()).toBe(true);
}
it.skipIf(process.env.TWITCH_PREDICTION_RELEASE_BROWSER_TEST!=='1')(
  'F08 Edge 320px release is inspect -> preview -> checkbox -> one explicit FIXE confirmation',async()=>withPage(async page=>{
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(0);
    expect(await page.getByRole('button',{name:'Préparer la libération locale'}).isDisabled()).toBe(true);
    await preview(page);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
    expect(await page.getByRole('button',{name:'Confirmer la libération sur FIXE'}).isDisabled()).toBe(true);
    await page.getByRole('checkbox',{name:/fin vérifiée sur Twitch/}).check();
    await page.getByRole('button',{name:'Confirmer la libération sur FIXE'}).click();
    await expect.poll(()=>page.getByText(/Libération locale confirmée/).isVisible()).toBe(true);
    expect(await page.getByRole('button',{name:'Préparer la libération locale'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.map((x:any)=>[x.path,x.method]))).toEqual([
      ['/api/v1/twitch/advanced/prediction/reconcile','GET'],
      ['/api/v1/twitch/advanced/prediction/reconcile/preview','POST'],
      ['/api/v1/twitch/advanced/prediction/reconcile/confirm','POST'],
    ]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
  }),30000);
it.skipIf(process.env.TWITCH_PREDICTION_RELEASE_BROWSER_TEST!=='1')(
  'F08 nonterminal, missing and unavailable states never expose consent or POST',async()=>withPage(async page=>{
    for(const mode of ['absent','active','down']) {
      await page.evaluate(mode=>(window as any).mode=mode,mode);
      await inspect(page);
      expect(await page.getByRole('button',{name:'Préparer la libération locale'}).isDisabled()).toBe(true);
      expect(await page.getByRole('button',{name:'Confirmer la libération sur FIXE'}).isVisible()).toBe(false);
    }
    expect(await page.evaluate(()=>(window as any).calls.every((x:any)=>x.method==='GET'))).toBe(true);
    expect(await page.getByRole('status').textContent()).not.toContain('SECRET');
  }),30000);
it.skipIf(process.env.TWITCH_PREDICTION_RELEASE_BROWSER_TEST!=='1')(
  'F08 source change during ambiguous release discards late receipt and never retries',async()=>withPage(async page=>{
    await page.evaluate(()=>(window as any).mode='late');
    await preview(page);
    await page.getByRole('checkbox',{name:/fin vérifiée sur Twitch/}).check();
    await page.getByRole('button',{name:'Confirmer la libération sur FIXE'}).click();
    await expect.poll(()=>page.evaluate(()=>typeof (window as any).finishConfirm)).toBe('function');
    await page.evaluate(()=>{const w=window as any;
      w.release.update({sourceKey:'OTHER',accountKey:'owner',online:true});w.finishConfirm();});
    await expect.poll(()=>page.getByText(/Résultat de libération incertain/).isVisible()).toBe(true);
    expect(await page.getByText(/Libération locale confirmée/).count()).toBe(0);
    expect(await page.getByRole('button',{name:'Préparer la libération locale'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(3);
  }),30000);

it.skipIf(process.env.TWITCH_PREDICTION_RELEASE_BROWSER_TEST!=='1')(
  'F08 lost local release receipt is uncertain and never auto-replayed',async()=>withPage(async page=>{
    await preview(page);
    await page.evaluate(()=>(window as any).mode='lost');
    await page.getByRole('checkbox',{name:/fin vérifiée sur Twitch/}).check();
    await page.getByRole('button',{name:'Confirmer la libération sur FIXE'}).click();
    await expect.poll(()=>page.getByText(/Résultat de la libération incertain/).isVisible()).toBe(true);
    expect(await page.getByRole('button',{name:'Préparer la libération locale'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(3);
    await page.waitForTimeout(80);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(3);
    expect(await page.getByRole('status').textContent()).not.toContain('PRIVATE_SECRET');
  }),30000);

it.skipIf(process.env.TWITCH_PREDICTION_RELEASE_BROWSER_TEST!=='1')(
  'F08 detached root during host commit never treats lost confirmation as safe',async()=>withPage(async page=>{
    await page.evaluate(()=>(window as any).mode='late');
    await preview(page);
    await page.getByRole('checkbox',{name:/fin vérifiée sur Twitch/}).check();
    await page.getByRole('button',{name:'Confirmer la libération sur FIXE'}).click();
    await expect.poll(()=>page.evaluate(()=>typeof (window as any).finishConfirm)).toBe('function');
    await page.evaluate(()=>{
      const w=window as any; w.detached=document.getElementById('root');
      w.detached.remove(); w.finishConfirm();
    });
    await page.waitForTimeout(50);
    await page.evaluate(()=>{
      const w=window as any;document.body.append(w.detached);
      w.release.update({sourceKey:'FIXE',accountKey:'owner',online:true});
    });
    await expect.poll(()=>page.getByText(/Reçu perdu après confirmation possible/).isVisible()).toBe(true);
    expect(await page.getByText(/Libération locale confirmée/).count()).toBe(0);
    expect(await page.getByRole('button',{name:'Préparer la libération locale'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(3);
  }),30000);
