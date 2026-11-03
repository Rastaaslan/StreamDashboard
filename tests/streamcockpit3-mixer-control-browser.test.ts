import {it,expect} from 'vitest';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {withMixerFixture} from './helpers/streamcockpit-mixer-fixture.js';
it.skipIf(process.env.SC3_FINAL_BROWSER_TEST!=='1')('F05 Edge 320px + real HTTP/OBS WS: consent, readback, rollback, lost receipt and page restart',async()=>withMixerFixture(async f=>{
 const bundle=await build({stdin:{contents:"import {mountMixerPage} from './apps/mobile/control/streamcockpit-mixer-page.js';window.mountMixer=mountMixerPage;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:740},hasTouch:true});
  const mount=async()=>{
   await page.addStyleTag({content:readFileSync('apps/mobile/control/streamcockpit-mobile-v2.css','utf8')});await page.addScriptTag({content:bundle.outputFiles[0].text});
   await page.evaluate(({credential,origin})=>{
    const w=window as any;w.requests=[];
    w.panel=w.mountMixer(document.getElementById('root'),{online:true,controls:{authorityKey:origin},request:async(path:string,body:any,method='GET')=>{
     w.requests.push({path,method});const response=await fetch(path,{method,headers:{'Content-Type':'application/json',authorization:'Device '+credential},...(body===undefined?{}:{body:JSON.stringify(body)})});
     const value=await response.json();if(!response.ok)throw Error('UNAVAILABLE');return value;
    }});
   },{credential:f.paired.credential,origin:f.origin});
  };
  await page.goto(f.origin);await mount();
  const region=page.getByRole('region',{name:'Commander le mixeur OBS'}),checkbox=region.getByLabel('Confirmer le réglage audio'),confirm=region.getByRole('button',{name:'Appliquer le réglage audio'});
  await expect.poll(()=>page.getByLabel('Source OBS du mixeur').inputValue()).toBe('Micro QA');
  await page.getByLabel('Gain OBS',{exact:true}).fill('0.5');await region.getByRole('button',{name:'Prévisualiser le réglage audio'}).click();
  await expect.poll(()=>checkbox.isVisible()).toBe(true);expect(await confirm.isDisabled()).toBe(true);expect(f.state().writes).toBe(0);
  await page.evaluate(()=>(window as any).panel.refresh());expect(await checkbox.isVisible()).toBe(true);
  await checkbox.check();await confirm.click();await expect.poll(()=>region.getByRole('status').textContent()).toContain('confirmé par relecture');
  expect(f.state()).toMatchObject({gain:.5,writes:1});
  await region.getByRole('button',{name:'Préparer le retour au réglage précédent'}).click();await expect.poll(()=>checkbox.isVisible()).toBe(true);
  await checkbox.check();await confirm.click();await expect.poll(()=>f.state().gain).toBe(.75);expect(f.state().writes).toBe(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
  await page.getByLabel('Réglage audio',{exact:true}).selectOption('mute');await region.getByRole('button',{name:'Prévisualiser le réglage audio'}).click();await expect.poll(()=>checkbox.isVisible()).toBe(true);
  f.setMode('lost');await checkbox.check();await confirm.click();await expect.poll(()=>region.getByRole('status').textContent(),{timeout:8000}).toContain('incertain');expect(f.state().writes).toBe(3);
  await page.reload();await mount();await expect.poll(()=>region.getByRole('status').textContent()).toContain('incertain');
  expect(await region.getByRole('button',{name:'Prévisualiser le réglage audio'}).isDisabled()).toBe(true);expect(f.state().writes).toBe(3);
  expect(await page.evaluate(()=>(window as any).requests.some((r:any)=>r.path.endsWith('/confirm')))).toBe(false);
  await page.evaluate(()=>(window as any).panel.destroy());
 }finally{await browser.close()}
}),40_000);
