import {expect, it} from 'vitest';
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
// @ts-expect-error Browser JavaScript is checked by check:browser-types.
import {classicDashboardReadiness} from '../apps/web/classic-readiness.js';

const source = readFileSync('apps/web/app.js','utf8');
function extract(from:string,until:string){
  const start=source.indexOf(from),end=source.indexOf(until,start+from.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start,end);
}
const overviewSource=extract('function overview() {','\nfunction preflightBlock() {');
const headerSource=extract('function updateHeader() {','\nfunction dirtyForm() {');
function fixture(status:'ready'|'action-required'|'error'|'idle'='ready'){
  return {runtime:true,obs:{connected:true,streaming:false,streamingKnown:true},twitch:{connected:true},
    preflight:{status},checklist:[{done:true}],nextLive:null,timer:{},settings:{}};
}
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,'');
const overview=(state:ReturnType<typeof fixture>)=>new Function('state','classicDashboardReadiness','duration','timerRemaining','esc','eventRange',
  overviewSource+'\nreturn overview();')(state,classicDashboardReadiness,()=> '0:00',()=>0,esc,()=> '') as string;

it('legacy banner rejects connected OBS/Twitch with missing or blocked preflight',()=>{
 for(const status of ['action-required','error','idle'] as const){
  const state=fixture(status);
  expect(classicDashboardReadiness(state).ready).toBe(false);
  const html=overview(state);
  expect(html).toContain('À VÉRIFIER');
  expect(html).toContain('Préparation à vérifier avant le live.');
  expect(html).not.toContain('TOUT EST PRÊT');
 }
});

it('legacy banner requires completed nonempty checklist, known OBS state and connected runtime',()=>{
 const state=fixture();
 const variations=[
  {...state,checklist:[]}, {...state,checklist:[{done:false}]},
  {...state,obs:{...state.obs,streamingKnown:false}},
  {...state,obs:{...state.obs,connected:false}},
  {...state,runtime:false}, {...state,twitch:{connected:false}},
 ];
 for(const value of variations)expect(classicDashboardReadiness(value).ready).toBe(false);
});

it('legacy banner displays ready only with validated inactive preflight',()=>{
 const state=fixture();
 expect(classicDashboardReadiness(state)).toEqual({ready:true,live:false});
 expect(overview(state)).toContain('TOUT EST PRÊT');
 expect(overview(state)).toContain('Prêt pour le prochain live.');
});

it('legacy banner distinguishes active OBS stream from start-ready status',()=>{
 const state=fixture();
 state.obs.streaming=true;
 expect(classicDashboardReadiness(state)).toEqual({ready:false,live:true});
 const html=overview(state);
 expect(html).toContain('EN DIRECT');
 expect(html).toContain('Le direct est en cours.');
 expect(html).not.toContain('TOUT EST PRÊT');
});

it.skipIf(process.env.SC3_AUDIT_BROWSER_TEST!=='1')('real Edge 320px renders unfounded ready status as verification-needed, without requests',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:780}});
  const requests:string[]=[];
  await page.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="pc-pill"></div><div id="obs-pill"></div><div id="twitch-pill"></div><div id="live-pill"></div><div id="quick-actions"></div><main id="view"></main>');
  for(const status of ['error','ready','action-required'] as const){
   const state=fixture(status);
   await page.evaluate(({header,assessor,state,markup})=>{
    const helper=new Function('return ('+assessor+')')();
    new Function('state','classicDashboardReadiness','$',header+'\nupdateHeader();')(state,helper,(query:string)=>document.querySelector(query));
    const root=document.querySelector('#view');if(root)root.innerHTML=markup;
   },{header:headerSource,assessor:String(classicDashboardReadiness),state,markup:overview(state)});
   const shouldReady=status==='ready';
   expect((await page.locator('#pc-pill').innerText()).includes('TOUT EST PRÊT')).toBe(shouldReady);
   expect((await page.locator('.hero .kicker').innerText()).includes('TOUT EST PRÊT')).toBe(shouldReady);
  }
  expect(requests).toEqual([]);
 }finally{await browser.close();}
},30000);
