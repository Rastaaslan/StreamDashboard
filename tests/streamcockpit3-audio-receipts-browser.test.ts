import {it,expect} from 'vitest';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {withMixerFixture} from './helpers/streamcockpit-mixer-fixture.js';

it.skipIf(process.env.SC3_FINAL_BROWSER_TEST!=='1')('F05 integrated UI in Edge 320px recovers lost HTTP ACK after durable router restart and offers a NEW guarded rollback',async()=>withMixerFixture(async f=>{
 // The explicit F03/F05 ownership transfer now permits testing the integrated
 // source directly, rather than accidentally exercising the previous Git HEAD.
 const source=await readFile(new URL('../apps/mobile/control/streamcockpit-mixer-control.js',import.meta.url),'utf8');
 const bundle=await build({stdin:{contents:source+'\nwindow.mountAudio=mountMixerControl;',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:740},hasTouch:true});
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==f.origin)return route.abort();return route.continue()});
  const mount=async(drop:boolean)=>{
   await page.addScriptTag({content:bundle.outputFiles[0].text});
   await page.evaluate(({credential,origin,drop})=>{
    const w=window as any;w.requests=[];w.drop=drop;
    w.panel=w.mountAudio(document.getElementById('root'),{authorityKey:origin,request:async(path:string,body:unknown,method='GET')=>{
     w.requests.push({path,method});
     const response=await fetch(path,{method,headers:{'Content-Type':'application/json',authorization:'Device '+credential},...(body===undefined?{}:{body:JSON.stringify(body)})});
     const value=await response.json();if(!response.ok)throw Error('UNAVAILABLE');
     if(w.drop&&path.endsWith('/confirm')){w.drop=false;throw Error('TEST_LOST_HTTP_ACK')}
     return value;
    }});w.panel.sources([{id:'Micro QA',name:'Micro QA'}]);
   },{credential:f.paired.credential,origin:f.origin,drop});
  };
  await page.goto(f.origin);await mount(true);
  const section=page.getByRole('region',{name:'Commander le mixeur OBS'});
  await page.locator('[name=gain]').fill('0.5');await section.locator('button[type=submit]').click();
  await expect.poll(()=>section.locator('[data-consent]').isVisible()).toBe(true);
  await section.getByLabel('Confirmer le réglage audio',{exact:true}).check();await section.locator('[data-confirm]').click();
  await expect.poll(()=>section.getByRole('status').textContent()).toContain('incertain');
  expect(f.state().writes).toBe(1);await f.restartRouter();
  await page.reload();await mount(false);
  await expect.poll(()=>section.getByRole('status').textContent()).toContain('confirmé par relecture');
  expect(await page.evaluate(()=>(window as any).requests.filter((r:any)=>r.method==='POST'))).toEqual([]);
  expect(f.state().writes).toBe(1);
  await section.locator('[data-rollback]').click();
  await expect.poll(()=>section.locator('[data-consent]').isVisible()).toBe(true);
  expect(f.state().writes).toBe(1);
  await section.getByLabel('Confirmer le réglage audio',{exact:true}).check();await section.locator('[data-confirm]').click();
  await expect.poll(()=>f.state().gain).toBe(.75);expect(f.state().writes).toBe(2);
  await page.evaluate(()=>(window as any).panel.destroy());
 }finally{await browser.close()}
},true),30000);
