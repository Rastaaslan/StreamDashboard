import {it,expect} from 'vitest';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {withContextFixture} from './helpers/streamcockpit-context-fixture.js';
it.skipIf(process.env.SC3_FINAL_BROWSER_TEST!=='1')('F03/F07 Edge 320px: authenticated master banks, explicit OBS command, offline and expiry fences',async()=>withContextFixture(async f=>{
 const bundle=await build({stdin:{contents:"import {mountMasterContext} from './apps/mobile/control/streamcockpit-master-context.js';window.mountContext=mountMasterContext;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:740},hasTouch:true}),external:string[]=[];
  await page.route('**/*',route=>{if(route.request().url().startsWith(f.origin+'/'))return route.continue();external.push(route.request().url());return route.abort()});
  await page.goto(f.origin);await page.addStyleTag({content:readFileSync('apps/mobile/control/streamcockpit-mobile-v2.css','utf8')});await page.addScriptTag({content:bundle.outputFiles[0].text});
  f.setGame('<img src="https://invalid.example/private" onerror="alert(1)">');
  await page.evaluate(({credential})=>{
   const w=window as any;w.receipts=[];w.shortTtl=false;
   const root=document.getElementById('root');root!.className='panel';
   w.panel=w.mountContext(root,{online:true,request:async()=>{
    const r=await fetch('/api/v1/streamcockpit-context',{headers:{authorization:'Device '+credential}});if(!r.ok)throw Error('PRIVATE');const value=await r.json();if(w.shortTtl)value.validForMs=50;return value;
   },execute:async(action:string,proof:string)=>{
    const r=await fetch('/api/v2/actions',{method:'POST',headers:{'Content-Type':'application/json',authorization:'Device '+credential},body:JSON.stringify({id:crypto.randomUUID(),issuedAt:new Date().toISOString(),action,expectedContextToken:proof})});w.receipts.push(await r.json());
   }});
  },{credential:f.paired.credential});
  await expect.poll(()=>page.locator('#root').getAttribute('data-status')).toBe('known');
  expect(f.state().writes).toBe(0);expect(await page.getByRole('button',{name:'Clip',exact:true}).isDisabled()).toBe(true);
  expect(await page.locator('img').count()).toBe(0);expect(external).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await expect.poll(()=>f.obs.state.scene).toBe('Pause');await expect.poll(()=>page.getByRole('heading').textContent()).toBe('Pause');
  expect(f.state().writes).toBe(1);expect(await page.evaluate(()=>(window as any).receipts[0].status)).toBe('succeeded');
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));expect(await page.locator('#root button').count()).toBe(0);expect(f.state().writes).toBe(1);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect.poll(()=>page.locator('#root').getAttribute('data-status')).toBe('known');
  await page.evaluate(async()=>{(window as any).shortTtl=true;await(window as any).panel.refresh()});
  await expect.poll(()=>page.locator('#root').getAttribute('data-status')).toBe('unknown');expect(f.state().writes).toBe(1);
  expect(await page.evaluate(()=>(window as any).receipts.length)).toBe(1);expect(external).toEqual([]);
  await page.evaluate(()=>(window as any).panel.destroy());
 }finally{await browser.close()}
}),30_000);
