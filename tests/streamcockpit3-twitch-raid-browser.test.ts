import { build } from 'esbuild';
import { chromium, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

async function withPage(run:(page:Page)=>Promise<void>) {
  const bundle=await build({stdin:{
    contents:"import {mountTwitchRaid} from './apps/mobile/control/streamcockpit-twitch-raid.js'; globalThis.mountRaid=mountTwitchRaid;",
    resolveDir:process.cwd(),
  },bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    const external:string[]=[];
    await page.route('**/*',route=>{external.push(route.request().url());return route.abort()});
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root" style="width:100%;min-width:0;box-sizing:border-box"></main>');
    await page.addStyleTag({content:readFileSync('apps/mobile/control/streamcockpit-mobile-v2.css','utf8')});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      const w=window as any;
      w.calls=[];w.mode='ok';
      w.raid=w.mountRaid(document.getElementById('root'),{
        request:async(path:string,body:any,method:string,source:string)=>{
          w.calls.push({path,body,method,source});
          if(path.endsWith('/preview')){
            if(w.mode==='delayed')return new Promise(resolve=>{w.deliver=()=>resolve({
              schemaVersion:1,kind:'streamcockpit-raid-preview',
              confirmationId:'643e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5',
              expiresAt:Date.now()+30_000,targetLogin:'friendly_stream',
            })});
            return {schemaVersion:1,kind:'streamcockpit-raid-preview',
              confirmationId:'643e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5',
              expiresAt:Date.now()+30_000,targetLogin:'friendly_stream'};
          }
          if(path.endsWith('/confirm')){
            if(w.mode==='pending-confirm')return new Promise(resolve=>{w.finishConfirm=()=>resolve({
              schemaVersion:1,kind:'streamcockpit-raid-confirmation',
              status:'queued',targetLogin:'friendly_stream',transferVerified:false,
            })});
            if(w.mode==='uncertain')throw Error('PRIVATE_SHOULD_NOT_LEAK');
            return {schemaVersion:1,kind:'streamcockpit-raid-confirmation',
              status:'queued',targetLogin:'friendly_stream',transferVerified:false};
          }
          throw Error('UNEXPECTED');
        },
      });
      w.raid.update({sourceKey:'FIXE',online:true,accountKey:'channel_owner'});
    });
    await run(page);
    expect(external).toEqual([]);
    await page.evaluate(()=>(window as any).raid.destroy());
  }finally{await browser.close()}
}

it.skipIf(process.env.TWITCH_RAID_BROWSER_TEST!=='1')(
  'F08 Edge 320px raid requires separate preview and public-transfer consent',async()=>withPage(async page=>{
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(0);
    await page.getByLabel('Destination du raid Twitch (sans @)').fill('FRIENDLY_STREAM');
    await page.getByRole('button',{name:'Vérifier la destination sans raid'}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(1);
    expect(await page.evaluate(()=>(window as any).calls[0])).toMatchObject({
      path:'/api/v1/twitch/advanced/raid/preview',method:'POST',source:'FIXE',
      body:{target:{login:'friendly_stream'}},
    });
    const button=page.getByRole('button',{name:'Demander le raid sur Twitch'});
    expect(await button.isDisabled()).toBe(true);
    const consent=page.getByLabel(/Je confirme le raid/);await consent.check();
    await button.click();
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(2);
    expect(await page.evaluate(()=>(window as any).calls[1])).toMatchObject({
      path:'/api/v1/twitch/advanced/raid/confirm',method:'POST',source:'FIXE',
      body:{confirmed:true,confirmationId:'643e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5'},
    });
    await expect.poll(()=>page.locator('.cockpit-twitch-raid [role=status]').last().textContent())
      .toContain('transfert réel n’est PAS vérifié');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
  }),30000
);

it.skipIf(process.env.TWITCH_RAID_BROWSER_TEST!=='1')(
  'F08 disconnect rejects late destination preview, erases private data',async()=>withPage(async page=>{
    await page.evaluate(()=>(window as any).mode='delayed');
    await page.getByLabel('Destination du raid Twitch (sans @)').fill('friendly_stream');
    await page.getByRole('button',{name:'Vérifier la destination sans raid'}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(1);
    await page.evaluate(()=>(window as any).raid.update({sourceKey:'FIXE',online:false,accountKey:'channel_owner'}));
    await page.evaluate(()=>(window as any).deliver());
    expect(await page.getByLabel('Destination du raid Twitch (sans @)').inputValue()).toBe('');
    expect(await page.getByRole('button',{name:'Demander le raid sur Twitch'}).isVisible()).toBe(false);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(1);
  }),30000
);

it.skipIf(process.env.TWITCH_RAID_BROWSER_TEST!=='1')(
  'F08 uncertain raid outcome disables further sends, no retry or leak',async()=>withPage(async page=>{
    await page.getByLabel('Destination du raid Twitch (sans @)').fill('friendly_stream');
    await page.getByRole('button',{name:'Vérifier la destination sans raid'}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(1);
    await page.evaluate(()=>(window as any).mode='uncertain');
    await page.getByLabel(/Je confirme le raid/).check();
    await page.getByRole('button',{name:'Demander le raid sur Twitch'}).click();
    await expect.poll(()=>page.locator('.cockpit-twitch-raid [role=status]').last().textContent())
      .toContain('Issue du raid incertaine');
    expect(await page.getByRole('button',{name:'Vérifier la destination sans raid'}).isDisabled()).toBe(true);
    await page.waitForTimeout(100);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
    expect(await page.locator('main').textContent()).not.toContain('PRIVATE_SHOULD_NOT_LEAK');
  }),30000
);


it.skipIf(process.env.TWITCH_RAID_BROWSER_TEST!=='1')(
  'F08 an in-flight raid remains uncertain across reconnection until explicit Twitch reconciliation',async()=>withPage(async page=>{
    await page.evaluate(()=>(window as any).mode='pending-confirm');
    const target=page.getByLabel('Destination du raid Twitch (sans @)');
    await target.fill('friendly_stream');
    const preview=page.getByRole('button',{name:/Vérifier la destination sans raid/});
    await preview.click();
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(1);
    await page.getByLabel(/Je confirme le raid/).check();
    await page.getByRole('button',{name:'Demander le raid sur Twitch'}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(2);
    await page.evaluate(()=>{
      const w=window as any;
      w.raid.update({sourceKey:'FIXE',online:false,accountKey:'channel_owner'});
      w.raid.update({sourceKey:'FIXE',online:true,accountKey:'channel_owner'});
      w.finishConfirm();
    });
    await expect.poll(()=>page.locator('.cockpit-twitch-raid [role=status]').last().textContent())
      .toContain('Issue du raid incertaine');
    expect(await preview.isDisabled()).toBe(true);
    const reconcile=page.getByRole('button',{name:/J'ai vérifié l'état du raid dans Twitch/});
    await expect.poll(()=>reconcile.isEnabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
    await reconcile.click();
    expect(await preview.isDisabled()).toBe(false);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
  }),30000
);
