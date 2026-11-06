import {expect,it} from 'vitest';
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
// @ts-expect-error The browser JS module has its own check:browser-types project.
import {classicDashboardReadiness} from '../apps/web/classic-readiness.js';

const source=readFileSync('apps/web/app.js','utf8');
function extract(start:string,end:string) {
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 expect(a).toBeGreaterThanOrEqual(0);expect(b).toBeGreaterThan(a);
 return source.slice(a,b);
}
const headerSource=extract('function updateHeader() {','\nfunction dirtyForm() {');
const preflightSource=extract('function preflightBlock() {','\nfunction prepare() {');
const prepareSource=extract('function prepare() {','\nfunction preparation() {');
const updateSource=extract('function updateChecklist() {','\nasync function prepareLive() {');
function fixture() {
 return {runtime:true,obs:{connected:true,streaming:false,streamingKnown:true},twitch:{connected:true},
  preflight:{status:'ready'},checklist:[{id:'a',label:'Micro',done:true}],settings:{startMode:'intro',timerBrowserSource:''},timer:{}};
}
function renderHeader(state:ReturnType<typeof fixture>) {
 const elements=new Map<string,{textContent:string;className:string;hidden:boolean;innerHTML:string}>();
 for(const id of ['#pc-pill','#obs-pill','#twitch-pill','#live-pill','#quick-actions'])
   elements.set(id,{textContent:'',className:'',hidden:false,innerHTML:''});
 new Function('state','classicDashboardReadiness','$',headerSource+'\nupdateHeader()')(state,classicDashboardReadiness,(key:string)=>elements.get(key));
 return elements.get('#quick-actions')!.innerHTML;
}
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,'');
function renderPrepare(state:ReturnType<typeof fixture>) {
 return new Function('state','classicDashboardReadiness','esc','duration','timerRemaining',
  preflightSource+prepareSource+'\nreturn prepare()')(state,classicDashboardReadiness,esc,()=> '00:00',()=>0) as string;
}
it('quick start is withheld for incomplete checklist even with ready preflight and connected OBS',()=>{
 const state=fixture();state.checklist[0].done=false;
 expect(classicDashboardReadiness(state).ready).toBe(false);
 expect(renderHeader(state)).not.toContain('data-command="session.start"');
 expect(renderHeader(state)).toContain('data-value="prepare"');
});
it('quick start is withheld for unknown OBS stream status, unavailable Twitch or runtime',()=>{
 const state=fixture();
 for(const value of [
  {...state,obs:{...state.obs,streamingKnown:false}},
  {...state,runtime:false}, {...state,twitch:{connected:false}}
 ]) {
  expect(classicDashboardReadiness(value).ready).toBe(false);
  expect(renderHeader(value)).not.toContain('data-command="session.start"');
 }
 expect(renderHeader(state)).toContain('data-command="session.start"');
});
it('preparation status never says everything is ready with empty checklist or failed preflight',()=>{
 const state=fixture();state.checklist=[];
 expect(classicDashboardReadiness(state).ready).toBe(false);
 expect(renderPrepare(state)).not.toContain('id="prepare-status">Tout est prêt');
 const other=fixture();other.preflight.status='error';
 expect(classicDashboardReadiness(other).ready).toBe(false);
 expect(renderPrepare(other)).not.toContain('id="prepare-status">Tout est prêt');
});
it('incremental checklist refresh also revokes a formerly validated preparation status',()=>{
 const state=fixture(),label={textContent:''};
 const redraw=(value:ReturnType<typeof fixture>)=>
   new Function('state','classicDashboardReadiness','$','document',updateSource+'\nupdateChecklist()')(
     value,classicDashboardReadiness,(selector:string)=>selector==='#prepare-status'?label:null,
     {querySelector:()=>null});
 redraw(state);expect(label.textContent).toBe('Tout est prêt');
 state.preflight.status='error';redraw(state);expect(label.textContent).toBe('Préparation à vérifier');
 state.checklist[0].done=false;redraw(state);expect(label.textContent).toBe('Préparation incomplète');
});
it.skipIf(process.env.SC3_AUDIT_BROWSER_TEST!=='1')('real Edge 320px shows quick start only for genuinely ready state, without requests',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:320,height:780},hasTouch:true});
  const requests:string[]=[];
  await page.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><header id="quick-actions"></header><main id="view"></main>');
  for(const variant of ['incomplete','unknown','ready'] as const) {
   const state=fixture();
   if(variant==='incomplete')state.checklist[0].done=false;
   if(variant==='unknown')state.obs.streamingKnown=false;
   await page.evaluate(({header,prepare})=>{
    document.querySelector('#quick-actions')!.innerHTML=header;
    document.querySelector('#view')!.innerHTML=prepare;
   },{header:renderHeader(state),prepare:renderPrepare(state)});
   expect(await page.locator('#quick-actions [data-command="session.start"]').count()).toBe(variant==='ready'?1:0);
   expect(await page.locator('#prepare-status').innerText()).toBe(variant==='ready'?'Tout est prêt':variant==='unknown'?'Préparation à vérifier':'Préparation incomplète');
  }
  expect(requests).toEqual([]);
 } finally {await browser.close()}
},30000);
