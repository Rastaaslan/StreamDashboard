import {it,expect} from 'vitest';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

const run=process.env.SC3_FINAL_BROWSER_TEST==='1'?it:it.skip;
const bundle=()=>build({stdin:{contents:`import {mountTwitchModeration} from './apps/mobile/control/streamcockpit-twitch-moderation.js';window.mountModeration=mountTwitchModeration;`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
run('F02 real Edge 320px: manual AutoMod read, escaped text and zero automatic/public writes',async()=>{
  const output=await bundle(),browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    await page.setContent('<main id="root"></main>');await page.addScriptTag({content:output.outputFiles[0].text});
    await page.evaluate(()=>{
      const w=window as any;
      w.calls=[];
      w.panel=w.mountModeration(document.getElementById('root'),{request:async(path:string,_body:unknown,method:string,host:string)=>{
        w.calls.push({path,method,host});
        return {schemaVersion:1,kind:'streamcockpit-automod-observed',status:'partial-observation',
          observedAt:Date.now(),messages:[{id:'held-1',broadcasterId:'42',userId:'12',
          userName:'Viewer',text:'<script>window.leaked=true</script>',reason:'automod',heldAt:'2026-11-03T15:00:00Z'}]};
      }});
      w.panel.update({online:true,sourceKey:'FIXE',accountKey:'42'});
    });
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(0);
    await page.getByRole('button',{name:'Lire les retenues observées'}).click();
    await expect.poll(()=>page.getByLabel('Retenues AutoMod observées').locator('li').count()).toBe(1);
    expect(await page.getByLabel('Retenues AutoMod observées').textContent()).toContain('<script>');
    expect(await page.evaluate(()=>(window as any).leaked)).toBeUndefined();
    expect(await page.evaluate(()=>(window as any).calls)).toEqual([{path:'/api/v1/twitch/advanced/moderation/held',method:'GET',host:'FIXE'}]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
    await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
    await expect.poll(()=>page.getByLabel('Retenues AutoMod observées').locator('li').count()).toBe(0);
    expect(await page.getByRole('button',{name:'Lire les retenues observées'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(1);
  }finally{await browser.close()}
},30000);
