import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';

/** Opt-in visual proof: real Chromium, 320px/touch, no network or OBS commands. */
it.skipIf(process.env.MIXER_BROWSER_TEST !== '1')('F05 Plus mixer scrolls at 320px and fails closed after disconnect', async () => {
  const code = await build({
    stdin: {contents: "import {mountMixerPage} from './apps/mobile/control/streamcockpit-mixer-page.js';globalThis.mountMixerPage=mountMixerPage;",resolveDir:process.cwd()},
    bundle:true,write:false,format:'iife',platform:'browser',
  });
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    const external:string[]=[];
    await page.route('**/*', route => {external.push(route.request().url());return route.abort();});
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><main id="root" style="width:100%;min-width:0"></main>');
    await page.addStyleTag({content:readFileSync('apps/mobile/control/streamcockpit-mobile-v2.css','utf8')});
    await page.addScriptTag({content:code.outputFiles[0].text});
    await page.evaluate(() => {
      const w=window as any;w.calls=[];
      w.presenter=w.mountMixerPage(document.getElementById('root'),{online:true,
        request:async(path:string)=>{
          w.calls.push(path);
          return {schemaVersion:1,readOnly:true,owner:'FIXE',revision:'obs:3:9',errors:[],outputs:[],
            sources:[{id:'mic',name:'<img src="https://malicious.invalid/steal" onerror="alert(1)"> DJI',
              gain:{state:'known',value:0.6},mute:{state:'known',value:false},
              level:{state:'unknown',reason:'not-observed'},stream:{state:'unknown',reason:'not-observed'},
              monitor:{state:'unknown',reason:'not-observed'},vod:{state:'unknown',reason:'not-observed'},
              device:{state:'unknown',reason:'not-observed'}}]};
        }});
    });
    await expect.poll(() => page.locator('section[aria-label="Mixeur audio — lecture seule"] tr').count()).toBe(2);
    expect(await page.locator('img').count()).toBe(0);
    expect(await page.getByRole('button',{name:'Lire les pistes OBS'}).count()).toBe(1);
    // The new explicit read button does not request OBS track data automatically.
    expect(await page.locator('section[aria-label="Mixeur audio — lecture seule"]').textContent()).toContain('Inconnu');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 320)).toBe(true);
    expect(await page.evaluate(() => {
      const e=document.querySelector('section[aria-label="Mixeur audio — lecture seule"]')!;
      return e.scrollWidth > e.clientWidth && e.clientWidth <= 320;
    })).toBe(true);
    await page.screenshot({path:'/tmp/streamcockpit3-f05-mixer-mobile-320-20261101.png'});
    await page.evaluate(() => {const w=window as any;w.presenter.unavailable();});
    expect(await page.locator('table').count()).toBe(0);
    expect(await page.locator('main').textContent()).toContain('déconnecté');
    expect(await page.evaluate(()=>(window as any).calls)).toEqual(['/api/v1/streamcockpit-mixer']);
    expect(external).toEqual([]);
  } finally {await browser.close();}
},30000);
