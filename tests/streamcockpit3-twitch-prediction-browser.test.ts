import { build } from 'esbuild';
import { chromium, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

async function withPage(run:(page:Page)=>Promise<void>) {
  const bundle=await build({stdin:{
    contents:"import {mountTwitchPrediction} from './apps/mobile/control/streamcockpit-twitch-prediction.js'; globalThis.mountPrediction=mountTwitchPrediction;",
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
      const w=window as any;w.calls=[];w.mode='active';w.renderLate=null;
      w.prediction=w.mountPrediction(document.getElementById('root'),{
        request:async(path:string,body:any,method:string,source:string)=>{
          w.calls.push({path,body,method,source});
          if(w.mode==='late')return new Promise(resolve=>{
            w.renderLate=()=>resolve({schemaVersion:1,kind:'streamcockpit-prediction-snapshot',
              checkedAt:Date.now(),status:'active',title:'A stale title',
              outcomes:['old','old2'],mutationAvailable:false});
          });
          if(w.mode==='scope')throw Object.assign(new Error('SECRET_TOKEN'),{status:403});
          if(w.mode==='expires')return {schemaVersion:1,kind:'streamcockpit-prediction-snapshot',
            checkedAt:Date.now()-29800,status:'none',mutationAvailable:false};
          return {schemaVersion:1,kind:'streamcockpit-prediction-snapshot',
            checkedAt:Date.now(),status:'active',
            title:'<img src=x onerror=alert(1)>',outcomes:['Oui','Non'],
            mutationAvailable:false};
        },
      });
      w.prediction.update({sourceKey:'FIXE',accountKey:'owner',online:true});
    });
    await run(page);
    expect(external).toEqual([]);
    await page.evaluate(()=>(window as any).prediction.destroy());
  }finally{await browser.close();}
}

it.skipIf(process.env.TWITCH_PREDICTION_BROWSER_TEST!=='1')(
  'F08 Edge touch 320px prediction is manual, read-only and escapes Twitch text',async()=>withPage(async page=>{
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(0);
    await page.getByRole('button',{name:'Lire la prédiction en cours'}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(1);
    expect(await page.evaluate(()=>(window as any).calls[0])).toEqual({
      path:'/api/v1/twitch/advanced/prediction',body:undefined,method:'GET',source:'FIXE',
    });
    await expect.poll(()=>page.getByRole('status').textContent()).toContain('Prédiction en cours');
    expect(await page.locator('img').count()).toBe(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
  }),30000
);

it.skipIf(process.env.TWITCH_PREDICTION_BROWSER_TEST!=='1')(
  'F08 disconnect drops late private prediction response and has no automatic retry',async()=>withPage(async page=>{
    await page.evaluate(()=>(window as any).mode='late');
    await page.getByRole('button',{name:'Lire la prédiction en cours'}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(1);
    await page.evaluate(()=>{
      const w=window as any;w.prediction.update({sourceKey:'FIXE',accountKey:'owner',online:false});
      w.renderLate();
    });
    expect(await page.getByRole('status').textContent()).toContain('Source inaccessible');
    await page.evaluate(()=>(window as any).prediction.update({sourceKey:'FIXE',accountKey:'owner',online:true}));
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(1);
    expect(await page.getByRole('button',{name:'Lire la prédiction en cours'}).isDisabled()).toBe(false);
    expect(await page.getByRole('status').textContent()).not.toContain('stale');
  }),30000
);

it.skipIf(process.env.TWITCH_PREDICTION_BROWSER_TEST!=='1')(
  'F08 predicted state visibly expires instead of becoming stale forever',async()=>withPage(async page=>{
    await page.evaluate(()=>(window as any).mode='expires');
    await page.getByRole('button',{name:'Lire la prédiction en cours'}).click();
    await expect.poll(()=>page.getByRole('status').textContent()).toContain('Aucune prédiction active');
    await expect.poll(()=>page.getByRole('status').textContent(),{timeout:4000})
      .toContain('Observation périmée');
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(1);
  }),30000
);
