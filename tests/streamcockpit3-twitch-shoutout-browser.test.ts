import { build } from 'esbuild';
import { chromium, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

async function withPage(run:(page:Page)=>Promise<void>) {
  const bundle=await build({stdin:{
    contents:"import {mountTwitchShoutout} from './apps/mobile/control/streamcockpit-twitch-shoutout.js'; globalThis.mountShoutout=mountTwitchShoutout;",
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
      w.shoutout=w.mountShoutout(document.getElementById('root'),{
        request:async(path:string,body:any,method:string,source:string)=>{
          w.calls.push({path,body,method,source});
          if(path.endsWith('/preview')){
            if(w.mode==='delayed')return new Promise(resolve=>{w.deliver=()=>resolve({
              schemaVersion:1,kind:'streamcockpit-shoutout-preview',
              confirmationId:'643e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5',
              expiresAt:Date.now()+30_000,targetLogin:'friendly_stream',
            })});
            return {schemaVersion:1,kind:'streamcockpit-shoutout-preview',
              confirmationId:'643e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5',
              expiresAt:Date.now()+30_000,targetLogin:'friendly_stream'};
          }
          if(path.endsWith('/confirm')){
            if(w.mode==='uncertain')throw Error('PRIVATE_SHOULD_NOT_LEAK');
            return {schemaVersion:1,kind:'streamcockpit-shoutout-confirmation',
              status:'accepted',targetLogin:'friendly_stream'};
          }
          throw Error('UNEXPECTED');
        },
      });
      w.shoutout.update({sourceKey:'FIXE',online:true,accountKey:'channel_owner'});
    });
    await run(page);
    expect(external).toEqual([]);
    await page.evaluate(()=>(window as any).shoutout.destroy());
  }finally{await browser.close()}
}

it.skipIf(process.env.TWITCH_SHOUTOUT_BROWSER_TEST!=='1')(
  'F08 320px real Edge: voluntary preview, second consent, exactly one public command',
  async()=>withPage(async page=>{
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(0);
    const input=page.getByLabel('Chaîne Twitch (sans @)');
    await input.fill('FRIENDLY_STREAM');
    await page.getByRole('button',{name:'Vérifier la chaîne sans publier'}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(1);
    const first=await page.evaluate(()=>(window as any).calls[0]);
    expect(first).toMatchObject({method:'POST',source:'FIXE',
      path:'/api/v1/twitch/advanced/shoutout/preview',
      body:{target:{login:'friendly_stream'}}});
    const button=page.getByRole('button',{name:'Publier le shoutout sur Twitch'});
    expect(await button.isDisabled()).toBe(true);
    await page.getByLabel('Je confirme le shoutout public immédiat sur Twitch.').check();
    await button.click();
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(2);
    expect(await page.evaluate(()=>(window as any).calls[1])).toMatchObject({
      method:'POST',source:'FIXE',path:'/api/v1/twitch/advanced/shoutout/confirm',
      body:{confirmationId:'643e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5',confirmed:true},
    });
    await expect.poll(async()=>page.locator('.cockpit-twitch-shoutout [role=status]').last().textContent())
      .toContain('Twitch a accepté');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
  }),30_000
);

it.skipIf(process.env.TWITCH_SHOUTOUT_BROWSER_TEST!=='1')(
  'F08 disconnect drops private target, pending consent and delayed preview',
  async()=>withPage(async page=>{
    await page.evaluate(()=>(window as any).mode='delayed');
    await page.getByLabel('Chaîne Twitch (sans @)').fill('friendly_stream');
    await page.getByRole('button',{name:'Vérifier la chaîne sans publier'}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(1);
    await page.evaluate(()=>(window as any).shoutout.update({
      sourceKey:'FIXE',online:false,accountKey:'channel_owner'
    }));
    await page.evaluate(()=>(window as any).deliver());
    expect(await page.getByLabel('Chaîne Twitch (sans @)').inputValue()).toBe('');
    expect(await page.getByRole('button',{name:'Publier le shoutout sur Twitch'}).isVisible()).toBe(false);
    expect(await page.getByRole('button',{name:'Vérifier la chaîne sans publier'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(1);
  }),30_000
);

it.skipIf(process.env.TWITCH_SHOUTOUT_BROWSER_TEST!=='1')(
  'F08 lost Twitch receipt is uncertain and never silently re-sends',
  async()=>withPage(async page=>{
    await page.getByLabel('Chaîne Twitch (sans @)').fill('friendly_stream');
    await page.getByRole('button',{name:'Vérifier la chaîne sans publier'}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(1);
    await page.evaluate(()=>(window as any).mode='uncertain');
    await page.getByLabel('Je confirme le shoutout public immédiat sur Twitch.').check();
    await page.getByRole('button',{name:'Publier le shoutout sur Twitch'}).click();
    await expect.poll(async()=>page.locator('.cockpit-twitch-shoutout [role=status]').last().textContent())
      .toContain('Issue du shoutout incertaine');
    expect(await page.getByRole('button',{name:'Vérifier la chaîne sans publier'}).isDisabled()).toBe(true);
    await page.waitForTimeout(150);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
    expect(await page.locator('main').textContent()).not.toContain('PRIVATE_SHOULD_NOT_LEAK');
  }),30_000
);
