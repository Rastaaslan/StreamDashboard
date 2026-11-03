import {expect,it} from 'vitest';
import {build} from 'esbuild';
import {chromium,type Page} from '@playwright/test';

async function browserCase(run:(page:Page)=>Promise<void>){
  const bundle=await build({stdin:{
    contents:"import {mountTwitchPredictionLock} from './apps/mobile/control/streamcockpit-twitch-prediction-lock.js';globalThis.mountLock=mountTwitchPredictionLock;",
    resolveDir:process.cwd(),
  },bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    const external:string[]=[];
    await page.route('**/*',route=>{external.push(route.request().url());return route.abort()});
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root" style="width:100%;min-width:0;box-sizing:border-box"></main>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      const w=window as any;
      w.calls=[];w.mode='normal';w.resolveLate=undefined;
      w.lock=w.mountLock(document.getElementById('root'),{request:async(path:string,body:any,method:string,source:string)=>{
        w.calls.push({path,body,method,source});
        if(path.endsWith('/preview')){
          if(w.mode==='no-live')throw Object.assign(new Error('PRIVATE_SECRET'),{status:409});
          return {schemaVersion:1,kind:'streamcockpit-prediction-lock-preview',
            confirmationId:'11111111-1111-4111-8111-111111111111',
            providerStatus:'active',expiresAt:Date.now()+30000};
        }
        if(w.mode==='lost')throw Error('PRIVATE_PATCH_SECRET');
        if(w.mode==='late')return new Promise(resolve=>{w.resolveLate=()=>resolve({
          schemaVersion:1,kind:'streamcockpit-prediction-lock-confirmation',
          predictionId:'pred-777',status:'locked',
        });});
        return {schemaVersion:1,kind:'streamcockpit-prediction-lock-confirmation',
          predictionId:'pred-777',status:'locked'};
      }});
      w.lock.update({online:true,sourceKey:'FIXE',accountKey:'owner'});
    });
    await run(page);
    expect(external).toEqual([]);
    await page.evaluate(()=>(window as any).lock.destroy());
  } finally {await browser.close();}
}
async function prepare(page:Page){
  await page.getByRole('button',{name:'Vérifier la prédiction à verrouiller'}).click();
  await expect.poll(()=>page.getByRole('checkbox',{name:/fermer les paris/}).isVisible()).toBe(true);
}

it.skipIf(process.env.TWITCH_PREDICTION_LOCK_BROWSER_TEST!=='1')(
  'F08 Edge 320px lock is preview, explicit checkbox, one provider PATCH confirmation',async()=>browserCase(async page=>{
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(0);
    await prepare(page);
    expect(await page.getByRole('button',{name:'Confirmer le verrouillage Twitch'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(1);
    await page.getByRole('checkbox',{name:/fermer les paris/}).check();
    await page.getByRole('button',{name:'Confirmer le verrouillage Twitch'}).click();
    await expect.poll(()=>page.getByText(/Verrouillage accepté par Twitch/).isVisible()).toBe(true);
    expect(await page.getByRole('button',{name:'Vérifier la prédiction à verrouiller'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.map((x:any)=>[x.path,x.method]))).toEqual([
      ['/api/v1/twitch/advanced/prediction/lock/preview','POST'],
      ['/api/v1/twitch/advanced/prediction/lock/confirm','POST'],
    ]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
  }),30000);

it.skipIf(process.env.TWITCH_PREDICTION_LOCK_BROWSER_TEST!=='1')(
  'F08 preview errors and offline do not expose lock consent',async()=>browserCase(async page=>{
    await page.evaluate(()=>(window as any).mode='no-live');
    await page.getByRole('button',{name:'Vérifier la prédiction à verrouiller'}).click();
    await expect.poll(()=>page.getByRole('status').last().textContent()).toContain('Aucune modification envoyée');
    expect(await page.getByRole('checkbox',{name:/fermer les paris/}).isVisible()).toBe(false);
    await page.evaluate(()=>(window as any).lock.update({online:false,sourceKey:'FIXE',accountKey:'owner'}));
    expect(await page.getByRole('button',{name:'Vérifier la prédiction à verrouiller'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(1);
    expect(await page.getByRole('status').last().textContent()).not.toContain('PRIVATE_SECRET');
  }),30000);

it.skipIf(process.env.TWITCH_PREDICTION_LOCK_BROWSER_TEST!=='1')(
  'F08 lost PATCH acknowledgement stays uncertain, never retries after source reconnect',async()=>browserCase(async page=>{
    await prepare(page);
    await page.evaluate(()=>(window as any).mode='lost');
    await page.getByRole('checkbox',{name:/fermer les paris/}).check();
    await page.getByRole('button',{name:'Confirmer le verrouillage Twitch'}).click();
    await expect.poll(()=>page.getByText(/Résultat du verrouillage incertain/).isVisible()).toBe(true);
    expect(await page.getByRole('button',{name:'Vérifier la prédiction à verrouiller'}).isDisabled()).toBe(true);
    await page.evaluate(()=>{const w=window as any;
      w.lock.update({online:false,sourceKey:'FIXE',accountKey:'owner'});
      w.lock.update({online:true,sourceKey:'FIXE',accountKey:'owner'});
    });
    expect(await page.getByRole('button',{name:'Vérifier la prédiction à verrouiller'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
    expect(await page.getByRole('status').last().textContent()).not.toContain('PRIVATE_PATCH_SECRET');
  }),30000);

it.skipIf(process.env.TWITCH_PREDICTION_LOCK_BROWSER_TEST!=='1')(
  'F08 in-flight PATCH followed by a host change drops late receipt without retry',async()=>browserCase(async page=>{
    await prepare(page);
    await page.evaluate(()=>(window as any).mode='late');
    await page.getByRole('checkbox',{name:/fermer les paris/}).check();
    await page.getByRole('button',{name:'Confirmer le verrouillage Twitch'}).click();
    await expect.poll(()=>page.evaluate(()=>typeof (window as any).resolveLate)).toBe('function');
    await page.evaluate(()=>{const w=window as any;
      w.lock.update({online:true,sourceKey:'OTHER',accountKey:'owner'});
      w.resolveLate();
    });
    await page.waitForTimeout(75);
    expect(await page.getByRole('button',{name:'Vérifier la prédiction à verrouiller'}).isDisabled()).toBe(true);
    expect(await page.getByText(/Verrouillage accepté par Twitch/).count()).toBe(0);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
  }),30000);
