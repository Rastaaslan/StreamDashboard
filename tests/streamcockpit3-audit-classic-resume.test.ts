import {expect,it} from 'vitest';
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
// @ts-expect-error Classic JavaScript is checked separately by check:browser-types.
import {classicDashboardReadiness} from '../apps/web/classic-readiness.js';

const source=readFileSync('apps/web/app.js','utf8');
function extract(start:string,end:string){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 expect(a).toBeGreaterThanOrEqual(0);expect(b).toBeGreaterThan(a);
 return source.slice(a,b);
}
const socketSource=extract('function socket() {','\nnav();');
const headerSource=extract('function updateHeader() {','\nfunction dirtyForm() {');
const state={runtime:true,obs:{connected:true,streaming:false,streamingKnown:true},twitch:{connected:true},preflight:{status:'ready'},checklist:[{done:true,id:'mic'}],settings:{startMode:'intro'},timer:{}};

it.skipIf(process.env.SC3_AUDIT_BROWSER_TEST!=='1')('Edge: resuming a suspended tab invalidates old ready state immediately before its interval ticks',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:780}});
  const requests:string[]=[];
  await page.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
  await page.setContent('<span id="socket"></span><span id="pc-pill"></span><span id="obs-pill"></span><span id="twitch-pill"></span><span id="live-pill"></span><div id="quick-actions"></div>');
  const result=await page.evaluate(async({socketSource,headerSource,assessor,initial})=>{
   let clock=100000,visibility='visible';
   const intervals=new Map<number,()=>void>();const pending:((value:unknown)=>void)[]=[];const sockets:any[]=[];
   Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibility});
   Object.defineProperty(document,'hidden',{configurable:true,get:()=>visibility==='hidden'});
   class FakeWebSocket {
    static OPEN=1;readyState=0;onopen?:()=>void;onclose?:()=>void;onerror?:()=>void;onmessage?:(e:{data:string})=>void;
    constructor(_url:string){sockets.push(this)}
    open(){this.readyState=1;this.onopen?.()}
    close(){this.readyState=3;this.onclose?.()}
    emit(data:unknown){this.onmessage?.({data:JSON.stringify({type:'state.updated',data})})}
   }
   const sess=new Function('FakeWebSocket','initial','assessor','headerSource','socketSource','intervals','pending','clockNow',`
    let activeSocket,socketTrusted=false,state={...initial,uiObservationTrusted:false};
    const $=id=>document.querySelector(id),location={protocol:'http:',host:'local.invalid'};
    const WebSocket=FakeWebSocket,performance={now:clockNow};
    const setInterval=fn=>{const id=intervals.size+1;intervals.set(id,fn);return id};
    const clearInterval=id=>intervals.delete(id),setTimeout=()=>0;
    const classicDashboardReadiness=new Function('return ('+assessor+')')();
    function toast(){};
    function updateHeader(){new Function('state','classicDashboardReadiness','$',headerSource+'\\nupdateHeader()')(state,classicDashboardReadiness,$)}
    function render(){updateHeader()}
    function applyStateUpdate(next){state={...next,uiObservationTrusted:socketTrusted};render()}
    function request(){return new Promise(resolve=>pending.push(resolve))}
    ${socketSource}
    render();socket();return {read:()=>state};
   `)(FakeWebSocket,initial,assessor,headerSource,socketSource,intervals,pending,()=>clock);
   const snapshot=()=>({pill:document.querySelector('#pc-pill')?.textContent||'',button:document.querySelector('#quick-actions')?.innerHTML||''});
   sockets[0].open();sockets[0].emit(initial);
   pending.shift()?.(initial);await new Promise(resolve=>setTimeout(resolve,0));
   const ready=snapshot();
   visibility='hidden';document.dispatchEvent(new Event('visibilitychange'));
   clock+=46_000;visibility='visible';document.dispatchEvent(new Event('visibilitychange'));
   const resumed=snapshot(),onResumeProbes=pending.length;
   pending.shift()?.(initial);await new Promise(resolve=>setTimeout(resolve,0));
   const recovered=snapshot();
   // This GET started before suspension and must NOT revalidate its old sample.
   clock+=21_000;for(const tick of intervals.values())tick();
   const pendingBeforeSuspend=pending.length;
   visibility='hidden';document.dispatchEvent(new Event('visibilitychange'));
   clock+=25_000;visibility='visible';document.dispatchEvent(new Event('visibilitychange'));
   const expiredWithPending=snapshot();
   pending.shift()?.(initial);await new Promise(resolve=>setTimeout(resolve,0));
   const ignoredOldGet=snapshot();
   // A BFCache-style pageshow can resume without a visibilitychange event.
   sockets[0].emit(initial);clock+=46_000;window.dispatchEvent(new Event('pageshow'));
   const pageShown=snapshot();
   sockets[0].close();const afterClose=pending.length;
   window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'));
   return {ready,resumed,onResumeProbes,recovered,pendingBeforeSuspend,expiredWithPending,ignoredOldGet,pageShown,afterClose,afterClosedEvents:pending.length,intervals:intervals.size,trusted:sess.read().uiObservationTrusted};
  },{socketSource,headerSource,assessor:String(classicDashboardReadiness),initial:state});
  expect(result.ready.pill).toContain('TOUT EST PRÊT');
  expect(result.resumed.pill).toBe('RÉGIE À VÉRIFIER');
  expect(result.resumed.button).not.toContain('data-command');
  expect(result.onResumeProbes).toBe(1); // old GET settled; one bounded fresh GET after wake
  expect(result.recovered.pill).toContain('TOUT EST PRÊT');
  expect(result.pendingBeforeSuspend).toBe(1);
  expect(result.expiredWithPending.pill).toBe('RÉGIE À VÉRIFIER');
  expect(result.ignoredOldGet.pill).toBe('RÉGIE À VÉRIFIER');
  expect(result.pageShown.pill).toBe('RÉGIE À VÉRIFIER');
  expect(result.afterClosedEvents).toBe(result.afterClose);
  expect(result.intervals).toBe(0);
  expect(result.trusted).toBe(false);
  expect(requests).toEqual([]);
 }finally{await browser.close()}
},30000);
