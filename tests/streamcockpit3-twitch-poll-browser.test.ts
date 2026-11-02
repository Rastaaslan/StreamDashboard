import { build } from 'esbuild';
import { chromium, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

async function withPage(run: (page: Page) => Promise<void>) {
  const bundle = await build({stdin:{
    contents: "import {mountTwitchPoll} from './apps/mobile/control/streamcockpit-twitch-poll.js'; globalThis.mountTwitchPoll=mountTwitchPoll;",
    resolveDir:process.cwd(),
  }, bundle:true, write:false, format:'iife', platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    const external:string[]=[];
    await page.route('**/*',route=>{external.push(route.request().url());return route.abort()});
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root" style="width:100%;min-width:0;box-sizing:border-box"></main>');
    await page.addStyleTag({content:readFileSync('apps/mobile/control/streamcockpit-mobile-v2.css','utf8')});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(() => {
      const w=window as any;
      w.calls=[];w.mode='ok';w.confirmId='b467019c-3fbb-4ccb-a499-3c459d5ad173';
      w.poll=w.mountTwitchPoll(document.getElementById('root'),{request:async(path:string,body:any,method:string,source:string)=>{
        w.calls.push({path,body,method,source});
        if(path.endsWith('/preview')) {
          if(w.mode==='deferred-preview')return new Promise(resolve=>{w.resolvePreview=()=>resolve({
            schemaVersion:1,kind:'streamcockpit-poll-preview',confirmationId:w.confirmId,
            expiresAt:Date.now()+30_000,draft:body.draft,
          })});
          if(w.mode==='forbidden')throw Object.assign(new Error('PRIVATE_TOKEN'),{status:403});
          return {schemaVersion:1,kind:'streamcockpit-poll-preview',
            confirmationId:w.confirmId,expiresAt:Date.now()+30_000,draft:body.draft};
        }
        if(path.endsWith('/confirm')) {
          if(w.mode==='uncertain')throw new Error('PRIVATE_TOKEN');
          return {schemaVersion:1,kind:'streamcockpit-poll-confirmation',status:'confirmed',pollId:'poll_1'};
        }
        throw new Error('unexpected route');
      }});
      w.poll.update({online:true,sourceKey:'FIXE',accountKey:'twitch_123'});
    });
    await run(page);
    expect(external).toEqual([]);
    await page.evaluate(()=>(window as any).poll.destroy());
  }finally{await browser.close()}
}
const fill = async (page:Page) => {
  await page.getByLabel('Question du sondage Twitch').fill('Quel jeu ensuite ?');
  await page.getByLabel('Réponses (2 à 5, une par ligne)').fill('Minecraft\nAutre');
};

it.skipIf(process.env.TWITCH_POLL_BROWSER_TEST !== '1')('F08 tactile 320px: deliberate preview, checkbox and exactly one explicit publication',async()=>{
  await withPage(async page=>{
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(0);
    await fill(page);
    await page.getByRole('button',{name:'Prévisualiser sans publier'}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(1);
    const confirm=page.getByRole('button',{name:'Confirmer et publier sur Twitch'});
    expect(await confirm.isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls[0])).toMatchObject({
      path:'/api/v1/twitch/advanced/poll/preview',method:'POST',source:'FIXE',
    });
    await page.getByLabel('Je confirme la création immédiate d’un sondage public Twitch.').check();
    await confirm.click();
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(2);
    expect(await page.evaluate(()=>(window as any).calls[1])).toMatchObject({
      path:'/api/v1/twitch/advanced/poll/confirm',
      body:{confirmationId:'b467019c-3fbb-4ccb-a499-3c459d5ad173',confirmed:true},
      method:'POST',source:'FIXE',
    });
    await expect.poll(()=>page.getByRole('status').last().textContent()).toContain('Sondage confirmé');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
  });
},30000);

it.skipIf(process.env.TWITCH_POLL_BROWSER_TEST !== '1')('F08 disconnect discards pending preview and confidential draft, late response ignored',async()=>{
  await withPage(async page=>{
    await page.evaluate(()=>(window as any).mode='deferred-preview');
    await fill(page);
    await page.getByRole('button',{name:'Prévisualiser sans publier'}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(1);
    await page.evaluate(()=>(window as any).poll.update({online:false,sourceKey:'FIXE',accountKey:'twitch_123'}));
    await page.evaluate(()=>(window as any).resolvePreview());
    expect(await page.getByLabel('Question du sondage Twitch').inputValue()).toBe('');
    expect(await page.getByRole('button',{name:'Confirmer et publier sur Twitch'}).isVisible()).toBe(false);
    expect(await page.getByRole('button',{name:'Prévisualiser sans publier'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(1);
  });
},30000);

it.skipIf(process.env.TWITCH_POLL_BROWSER_TEST !== '1')('F08 lost confirmation remains uncertain, never automatically retries a public Twitch POST',async()=>{
  await withPage(async page=>{
    await fill(page);
    await page.getByRole('button',{name:'Prévisualiser sans publier'}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(1);
    await page.evaluate(()=>(window as any).mode='uncertain');
    await page.getByLabel('Je confirme la création immédiate d’un sondage public Twitch.').check();
    await page.getByRole('button',{name:'Confirmer et publier sur Twitch'}).click();
    await expect.poll(()=>page.getByRole('status').last().textContent()).toContain('Résultat de publication incertain');
    expect(await page.getByRole('button',{name:'Prévisualiser sans publier'}).isDisabled()).toBe(true);
    await page.waitForTimeout(150);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
    const text=await page.locator('main').textContent();
    expect(text).not.toContain('PRIVATE_TOKEN');
  });
},30000);
