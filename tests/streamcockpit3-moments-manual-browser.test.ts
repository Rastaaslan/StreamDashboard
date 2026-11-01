import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** Opt-in real Edge viewport test on FIXE: all API data stays in memory. */
it.skipIf(process.env.MOMENTS_BROWSER_TEST !== '1')('F09 manual creation is explicit and accessible at 320px without provider traffic',async()=>{
  const bundle=await build({stdin:{contents:"import {mountMomentsPage} from './apps/mobile/control/streamcockpit-moments-page.js';globalThis.mountMomentsPage=mountMomentsPage;",resolveDir:process.cwd()},
    bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    const external:string[]=[];
    await page.route('**/*',route=>{external.push(route.request().url());return route.abort();});
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root" class="compact-app" style="width:100%;min-width:0"></main>');
    await page.addStyleTag({content:readFileSync('apps/mobile/control/streamcockpit-mobile-v2.css','utf8')});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      const w=window as any;
      w.calls=[];
      w.presenter=w.mountMomentsPage(document.getElementById('root'),{
        online:true,request:async (path:string,body?:unknown)=>{
          w.calls.push({path,body});
          if(path.endsWith('/manual/add'))return {schemaVersion:1,kind:'streamcockpit-manual-marker',
            outcome:'created',sessionId:'session_1',correlationId:'e'.repeat(64),
            instant:1800000000000,sequence:1,source:'manual',status:'observed'};
          return {schemaVersion:1,kind:'streamcockpit-markers',timebase:'unix-ms',readOnly:true,
            sessionId:'session_1',markers:[{sessionId:'session_1',instant:1800000000000,
              sequence:1,title:'Repère test',source:'manual',status:'observed'}]};
        },
      });
    });
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(0);
    await page.getByLabel('Nom du repère manuel').fill('Repère test');
    await page.getByRole('button',{name:'Enregistrer un repère manuel'}).click();
    await expect.poll(()=>page.getByLabel('Identifiant exact de session').inputValue()).toBe('session_1');
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(1);
    expect(await page.evaluate(()=>(window as any).calls[0].path)).toBe('/api/v1/streamcockpit-moments/manual/add');
    expect(await page.evaluate(()=>(window as any).calls[0].body.title)).toBe('Repère test');
    expect(await page.evaluate(()=>(window as any).calls[0].body.requestId)).toMatch(/^[a-f0-9-]{36}$/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
    await page.getByRole('button',{name:'Consulter'}).click();
    await expect.poll(()=>page.locator('section[aria-label="Moments marquants"] li').count()).toBe(1);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
    await page.evaluate(()=>(window as any).presenter.unavailable());
    expect(await page.getByRole('button',{name:'Enregistrer un repère manuel'}).isDisabled()).toBe(true);
    expect(await page.locator('main').textContent()).not.toContain('Repère test');
    expect(external).toEqual([]);
  }finally{await browser.close();}
},30000);
