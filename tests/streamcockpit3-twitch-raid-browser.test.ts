import {build} from 'esbuild';
import {chromium,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
const run=process.env.TWITCH_RAID_BROWSER_TEST==='1'?it:it.skip;
async function withPage(work:(page:Page)=>Promise<void>){
  const bundle=await build({stdin:{contents:"import {mountTwitchRaid} from './apps/mobile/control/streamcockpit-twitch-raid.js'; globalThis.mountRaid=mountTwitchRaid;",resolveDir:process.cwd()},
    bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    const external:string[]=[];
    await page.route('**/*',route=>{external.push(route.request().url());return route.abort()});
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root" style="width:100%;min-width:0;box-sizing:border-box"></main>');
    await page.addStyleTag({content:readFileSync('apps/mobile/control/streamcockpit-mobile-v2.css','utf8')});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      const w=window as any;w.calls=[];w.mode='ok';w.operation='start';
      w.raid=w.mountRaid(document.getElementById('root'),{request:async(path:string,body:any,method:string,source:string)=>{
        w.calls.push({path,body,method,source});
        if(path.endsWith('/preview')){
          w.operation=body.request.operation;
          const value={schemaVersion:1,kind:'streamcockpit-raid-preview',operation:w.operation,
            confirmationId:'643e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5',expiresAt:Date.now()+30000,
            ...(w.operation==='start'?{targetLogin:'friendly_stream'}:{})};
          if(w.mode==='delayed')return new Promise(resolve=>{w.deliver=()=>resolve(value)});
          return value;
        }
        if(path.endsWith('/confirm')){
          const value={schemaVersion:1,kind:'streamcockpit-raid-confirmation',operation:w.operation,
            status:w.operation==='start'?'requested':'cancel-accepted',
            ...(w.operation==='start'?{targetLogin:'friendly_stream'}:{})};
          if(w.mode==='uncertain')throw Error('PRIVATE_SHOULD_NOT_LEAK');
          if(w.mode==='confirm-delayed')return new Promise(resolve=>{w.deliver=()=>resolve(value)});
          return value;
        }
        throw Error('UNEXPECTED_ROUTE');
      }});
      w.raid.update({sourceKey:'FIXE',online:true,accountKey:'owner'});
    });
    await work(page);expect(external).toEqual([]);
    await page.evaluate(()=>(window as any).raid.destroy());
  }finally{await browser.close()}
}
const preview=async(page:Page)=>{
  await page.getByLabel('Chaîne Twitch à raider (sans @)').fill('FRIENDLY_STREAM');
  await page.getByRole('button',{name:'Vérifier sans lancer de raid'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(1);
};
const consent=async(page:Page)=>{
  await page.getByLabel('Je confirme cette action publique sur Twitch.').check();
  await page.getByRole('button',{name:'Confirmer sur Twitch'}).click();
};
run('F08 raid 320px: separate preview and consent, exact one request and honest pending result',()=>withPage(async page=>{
  expect(await page.evaluate(()=>(window as any).calls.length)).toBe(0);
  await preview(page);
  expect(await page.evaluate(()=>(window as any).calls[0])).toMatchObject({source:'FIXE',method:'POST',
    path:'/api/v1/twitch/advanced/raid/preview',body:{request:{operation:'start',login:'friendly_stream'}}});
  expect(await page.getByRole('button',{name:'Confirmer sur Twitch'}).isDisabled()).toBe(true);
  await consent(page);
  await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(2);
  expect(await page.evaluate(()=>(window as any).calls[1])).toMatchObject({method:'POST',
    path:'/api/v1/twitch/advanced/raid/confirm',body:{confirmed:true,confirmationId:'643e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5'}});
  await expect.poll(()=>page.getByRole('status').textContent()).toContain('n’est pas encore confirmé');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
}),30000);
run('F08 raid cancellation has its own exact preview and consent without inventing a pending target',()=>withPage(async page=>{
  await page.getByLabel('Action du raid').selectOption('cancel');
  expect(await page.getByLabel('Chaîne Twitch à raider (sans @)').isVisible()).toBe(false);
  await page.getByRole('button',{name:'Préparer la demande d’annulation'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).calls[0].body)).toEqual({request:{operation:'cancel'}});
  await consent(page);
  await expect.poll(()=>page.getByRole('status').textContent()).toContain('accepté l’annulation');
  expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
}),30000);
run('F08 uncertain raid stays locked through reconnect until manual Twitch reconciliation',()=>withPage(async page=>{
  await preview(page);await page.evaluate(()=>(window as any).mode='uncertain');await consent(page);
  await expect.poll(()=>page.getByRole('status').textContent()).toContain('incertain');
  await page.evaluate(()=>{const w=window as any;w.raid.update({sourceKey:'FIXE',online:false,accountKey:'owner'});w.raid.update({sourceKey:'FIXE',online:true,accountKey:'owner'});});
  expect(await page.getByRole('button',{name:'Vérifier sans lancer de raid'}).isDisabled()).toBe(true);
  await page.waitForTimeout(150);expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
  expect(await page.locator('main').textContent()).not.toContain('PRIVATE_SHOULD_NOT_LEAK');
  await page.getByRole('button',{name:'J’ai vérifié l’état du raid dans Twitch'}).click();
  expect(await page.getByRole('button',{name:'Vérifier sans lancer de raid'}).isDisabled()).toBe(false);
  expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
}),30000);
run('F08 delayed raid preview cannot restore consent or a private target after disconnect',()=>withPage(async page=>{
  await page.evaluate(()=>(window as any).mode='delayed');await preview(page);
  await page.evaluate(()=>{const w=window as any;w.raid.update({sourceKey:'FIXE',online:false,accountKey:'owner'});w.deliver();});
  expect(await page.getByLabel('Chaîne Twitch à raider (sans @)').inputValue()).toBe('');
  expect(await page.getByRole('button',{name:'Confirmer sur Twitch'}).isVisible()).toBe(false);
  expect(await page.evaluate(()=>(window as any).calls.length)).toBe(1);
}),30000);
run('F08 disconnected in-flight raid confirmation remains uncertain despite a late successful receipt',()=>withPage(async page=>{
  await preview(page);await page.evaluate(()=>(window as any).mode='confirm-delayed');await consent(page);
  await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(2);
  await page.evaluate(()=>{const w=window as any;w.raid.update({sourceKey:'FIXE',online:false,accountKey:'owner'});w.raid.update({sourceKey:'FIXE',online:true,accountKey:'owner'});w.deliver();});
  await expect.poll(()=>page.getByRole('status').textContent()).toContain('incertain');
  expect(await page.getByRole('button',{name:'Vérifier sans lancer de raid'}).isDisabled()).toBe(true);
  expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
}),30000);
