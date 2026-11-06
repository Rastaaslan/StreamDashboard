import {expect,it} from 'vitest';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {withMixerFixture} from './helpers/streamcockpit-mixer-fixture.js';
const test=process.env.SC3_FINAL_BROWSER_TEST==='1'?it:it.skip;
const bundle=()=>build({stdin:{contents:"import {mountMixerPage} from './apps/mobile/control/streamcockpit-mixer-page.js';window.mountMixer=mountMixerPage;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});

test('Edge 320px selects existing OBS tracks, confirms once, reads durable history after router restart and performs guarded rollback',async()=>withMixerFixture(async f=>{
 const built=await bundle(),browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:740},hasTouch:true});
  await page.route('**/*',route=>new URL(route.request().url()).origin===f.origin?route.continue():route.abort());
  const mount=async()=>{
   await page.addStyleTag({content:readFileSync('apps/mobile/control/streamcockpit-mobile-v2.css','utf8')});
   await page.addScriptTag({content:built.outputFiles[0].text});
   await page.evaluate(({origin,credential})=>{const w=window as any;w.requests=[];
    w.panel=w.mountMixer(document.getElementById('root'),{online:true,controls:{authorityKey:origin},request:async(path:string,body:unknown,method='GET')=>{
     w.requests.push({path,method});const r=await fetch(path,{method,headers:{authorization:'Device '+credential,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
     const value=await r.json();if(!r.ok)throw Error('UNAVAILABLE');return value;
    }});
   },{origin:f.origin,credential:f.paired.credential});
  };
  await page.goto(f.origin);await mount();
  const region=page.getByRole('region',{name:'Commander le mixeur OBS'});
  await expect.poll(()=>page.getByLabel('Source OBS du mixeur').inputValue()).toBe('Micro QA');
  await page.getByLabel('Réglage audio',{exact:true}).selectOption('tracks');
  await region.getByRole('button',{name:'Prévisualiser le réglage audio'}).click();
  expect(f.state().writes).toBe(0);expect(await region.locator('[data-consent]').isVisible()).toBe(false);
  await region.getByRole('button',{name:'Charger le routage actuel'}).click();
  await expect.poll(()=>region.locator('[data-routing-state]').textContent()).toContain('relus');
  expect(await page.getByLabel('Piste OBS 2',{exact:true}).isChecked()).toBe(true);
  await page.getByLabel('Piste OBS 2',{exact:true}).uncheck();await page.getByLabel('Piste OBS 4',{exact:true}).check();
  await region.getByRole('button',{name:'Prévisualiser le réglage audio'}).click();
  await expect.poll(()=>region.locator('[data-consent]').isVisible()).toBe(true);expect(f.state().writes).toBe(0);
  expect(await region.locator('[data-preview]').textContent()).toContain('1, 4');
  await region.getByLabel('Confirmer le réglage audio').check();await region.locator('[data-confirm]').click();
  await expect.poll(()=>region.getByRole('status').textContent()).toContain('confirmé par relecture');expect(f.state().writes).toBe(1);
  await f.restartRouter();await page.reload();await mount();
  await region.locator('[data-audio-history] summary').click();await region.locator('[data-history-refresh]').click();
  await expect.poll(()=>region.locator('[data-history-rows] li').count()).toBe(1);
  expect(await region.locator('[data-history-rows]').textContent()).toContain('pistes 1, 4');
  expect(await page.evaluate(()=>(window as any).requests.some((r:any)=>r.method==='POST'))).toBe(false);expect(f.state().writes).toBe(1);
  await region.getByRole('button',{name:'Préparer le retour pour ce réglage',exact:true}).click();
  await expect.poll(()=>region.locator('[data-consent]').isVisible()).toBe(true);expect(f.state().writes).toBe(1);
  await region.getByLabel('Confirmer le réglage audio').check();await region.locator('[data-confirm]').click();
  await expect.poll(()=>f.state().writes).toBe(2);expect(f.state().tracks['2']).toBe(true);expect(f.state().tracks['4']).toBe(false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
  await page.evaluate(()=>(window as any).panel.destroy());
 }finally{await browser.close()}
},true),40000);

test('Edge refuses a routing GET arriving after disconnect and does not let an older request enable a newer inspection',async()=>{
 const built=await bundle(),browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:740}});await page.route('**/*',r=>r.abort());
  await page.setContent('<main id="root"></main>');await page.addScriptTag({content:built.outputFiles[0].text});
  await page.evaluate(()=>{const w=window as any;w.pending=[];w.calls=[];
   const known={state:'known',value:1},unknown={state:'unknown',reason:'not-observed'};
   w.snapshot={schemaVersion:1,readOnly:true,owner:'FIXE',revision:'obs:1:1',errors:[],outputs:[],sources:[{id:'Game',name:'Game',gain:known,mute:{state:'known',value:false},level:unknown,stream:unknown,monitor:unknown,vod:unknown,device:unknown}]};
   w.route={schemaVersion:1,kind:'streamcockpit-obs-audio-routing',sourceId:'Game',vodTrack:'unverified',tracks:[1,2,3,4,5,6].map(number=>({number,enabled:number===1})),monitorType:'OBS_MONITORING_TYPE_NONE'};
   w.panel=w.mountMixer(document.getElementById('root'),{online:true,request:async(path:string)=>{w.calls.push(path);if(path.includes('/routing?'))return new Promise(r=>w.pending.push(r));return w.snapshot}});
  });
  const button=page.getByRole('button',{name:'Lire les pistes OBS'});
  await expect.poll(()=>button.isEnabled()).toBe(true);await button.click();
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));expect(await button.isDisabled()).toBe(true);
  await page.evaluate(()=>{const w=window as any;w.pending.shift()(w.route)});
  expect(await button.isDisabled()).toBe(true);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect.poll(()=>button.isEnabled()).toBe(true);
  await button.click();await page.evaluate(()=>{const w=window as any;return w.panel.refresh()});
  await expect.poll(()=>button.isEnabled()).toBe(true);await button.click();
  await page.evaluate(()=>{const w=window as any;w.pending.shift()(w.route)});expect(await button.isDisabled()).toBe(true);
  await page.evaluate(()=>{const w=window as any;w.pending.shift()(w.route)});await expect.poll(()=>button.isEnabled()).toBe(true);
  await page.evaluate(()=>(window as any).panel.destroy());
 }finally{await browser.close()}
},30000);

test('Edge history is explicitly paged GET-only, escapes source text and discards a response after offline',async()=>{
 const built=await bundle(),browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:740}});await page.route('**/*',r=>r.abort());
  await page.setContent('<main id="root"></main>');await page.addScriptTag({content:built.outputFiles[0].text});
  await page.evaluate(()=>{const w=window as any;w.calls=[];w.hold=false;
   const unknown={state:'unknown',reason:'not-observed'};
   w.panel=w.mountMixer(document.getElementById('root'),{online:true,controls:{authorityKey:'fixture',storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}},request:async(path:string,_b:unknown,method='GET')=>{
    w.calls.push({path,method});if(path.includes('/history')){
     if(w.hold)return new Promise(r=>{w.release=r});
     const sequence=path.includes('?')?1:2;
     return {schemaVersion:1,kind:'streamcockpit-mixer-history',readOnly:true,nextBefore:sequence===2?2:null,entries:[{sequence,recordedAt:1000,receipt:{schemaVersion:1,kind:'streamcockpit-mixer-receipt',confirmationId:'a'.repeat(8)+'-aaaa-aaaa-aaaa-'+'a'.repeat(12),status:'uncertain',change:{sourceId:'<img src=x onerror=alert(1)>',mute:true},rollbackAvailable:false}}]};
    }
    return {schemaVersion:1,readOnly:true,owner:'FIXE',revision:'obs:1',errors:[],outputs:[],sources:[{id:'Game',name:'Game',gain:unknown,mute:unknown,level:unknown,stream:unknown,monitor:unknown,vod:unknown,device:unknown}]};
   }});
  });
  await page.locator('[data-audio-history] summary').click();await page.locator('[data-history-refresh]').click();
  await expect.poll(()=>page.locator('[data-history-rows] li').count()).toBe(1);
  await page.locator('[data-history-more]').click();await expect.poll(()=>page.locator('[data-history-rows] li').count()).toBe(2);
  expect(await page.locator('img').count()).toBe(0);expect(await page.locator('[data-history-rows] button').count()).toBe(0);
  expect(await page.evaluate(()=>(window as any).calls.every((r:any)=>r.method==='GET'))).toBe(true);
  await page.evaluate(()=>{(window as any).hold=true});await page.locator('[data-history-refresh]').click();
  await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));(window as any).release({schemaVersion:1,kind:'streamcockpit-mixer-history',readOnly:true,entries:[],nextBefore:null})});
  expect(await page.locator('[data-history-rows] li').count()).toBe(0);expect(await page.locator('[data-history-refresh]').isDisabled()).toBe(true);
  await page.evaluate(()=>(window as any).panel.destroy());
 }finally{await browser.close()}
},30000);
