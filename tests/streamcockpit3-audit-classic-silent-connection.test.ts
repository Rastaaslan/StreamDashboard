import {expect,it} from 'vitest';
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
// @ts-expect-error Browser JavaScript is checked via check:browser-types.
import {classicDashboardReadiness} from '../apps/web/classic-readiness.js';

const source=readFileSync('apps/web/app.js','utf8');
function extract(start:string,end:string){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 expect(a).toBeGreaterThanOrEqual(0);expect(b).toBeGreaterThan(a);
 return source.slice(a,b);
}
const socketSource=extract('function socket() {','\nnav();');
const headerSource=extract('function updateHeader() {','\nfunction dirtyForm() {');
const requestSource=extract('async function request(', '\nconst messages = {');
const fixture=()=>({
 runtime:true, obs:{connected:true,streaming:false,streamingKnown:true},twitch:{connected:true},
 preflight:{status:'ready'},checklist:[{done:true,label:'Micro',id:'micro'}],
 settings:{startMode:'intro',timerBrowserSource:''},timer:{}
});
it('fresh UI readiness GET bypasses HTTP cache but other requests keep normal semantics',async()=>{
 const seen:{url:string;cache?:string}[]=[];
 const fetcher=async(url:string,options:{cache?:string})=>{
  seen.push({url,cache:options.cache});
  return {ok:true,status:200,json:async()=>({ok:true})};
 };
 const getRequest=new Function('fetch','const REQUEST_TIMEOUT_MS=30_000;\n'+requestSource+'\nreturn request;')(fetcher);
 await getRequest('/api/v1/state');
 await getRequest('/api/v1/profile');
 expect(seen).toEqual([
  {url:'/api/v1/state',cache:'no-store'},
  {url:'/api/v1/profile',cache:'default'}
 ]);
});

it.skipIf(process.env.SC3_AUDIT_BROWSER_TEST!=='1')(
 'Edge: an open but silent socket loses readiness, bounded fresh GET recovers, late GET never overrides push',
 async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
   const page=await browser.newPage({viewport:{width:320,height:780},hasTouch:true});
   const requests:string[]=[];
   await page.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
   await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="socket"></div><span id="pc-pill"></span><span id="obs-pill"></span><span id="twitch-pill"></span><span id="live-pill"></span><section id="quick-actions"></section>');
   const result=await page.evaluate(async ({socketSource,headerSource,assessor,initial})=>{
    const sockets:any[]=[],intervals=new Map<number,()=>void>(),resolvers:((value:unknown)=>void)[]=[];
    let clock=100000,intervalId=1;
    class FakeWebSocket {
     static OPEN=1;readyState=0;
     onopen?:()=>void;onclose?:()=>void;onerror?:()=>void;onmessage?:(event:{data:string})=>void;
     constructor(_url:string){sockets.push(this)}
     open(){this.readyState=1;this.onopen?.()}
     close(){this.readyState=3;this.onclose?.()}
     emit(value:unknown){this.onmessage?.({data:JSON.stringify({type:'state.updated',data:value})})}
    }
    const readiness=new Function('return ('+assessor+')')();
    const session=new Function('FakeWebSocket','readiness','initial','headerSource','socketSource',
      'request','setIntervalFake','clearIntervalFake','clockNow',`
      let activeSocket,socketTrusted=false,state={...initial,uiObservationTrusted:false};
      const $=id=>document.querySelector(id);
      const location={protocol:'http:',host:'localhost.invalid'};
      const WebSocket=FakeWebSocket;
      const setTimeout=()=>0;
      const setInterval=setIntervalFake, clearInterval=clearIntervalFake;
      const performance={now:clockNow};
      const classicDashboardReadiness=readiness;
      function toast(){}
      function updateHeader(){new Function('state','classicDashboardReadiness','$',headerSource+'\\nupdateHeader()')(state,classicDashboardReadiness,$)}
      function render(){updateHeader()}
      function applyStateUpdate(next){state={...next,uiObservationTrusted:socketTrusted};render()}
      ${socketSource}
      render();socket();
      return {readState:()=>state};
      `)(FakeWebSocket,readiness,initial,headerSource,socketSource,
       ()=>new Promise(resolve=>resolvers.push(resolve)),
       (fn:()=>void)=>{const id=intervalId++;intervals.set(id,fn);return id},
       (id:number)=>intervals.delete(id),()=>clock);
    const observe=()=>({pc:document.querySelector('#pc-pill')?.textContent||'',
      actions:document.querySelector('#quick-actions')?.innerHTML||'',
      socket:document.querySelector('#socket')?.textContent||''});
    sockets[0].open();
    sockets[0].emit(initial);
    const ready=observe();
    resolvers.shift()?.(initial);await new Promise(resolve=>setTimeout(resolve,0));
    clock+=46_000;
    for(const tick of [...intervals.values()])tick();
    const expired=observe(),pollCount=resolvers.length;
    for(const tick of [...intervals.values()])tick();
    const repeatedPollCount=resolvers.length;
    resolvers.shift()?.(initial);await new Promise(resolve=>setTimeout(resolve,0));
    const recovered=observe();
    clock+=21_000;
    for(const tick of [...intervals.values()])tick();
    const pendingPolls=resolvers.length;
    const notReady={...initial,preflight:{status:'error'}};
    sockets[0].emit(notReady);
    const newerPush=observe();
    resolvers.shift()?.(initial);await new Promise(resolve=>setTimeout(resolve,0));
    const lateGet=observe();
    sockets[0].close();
    const disconnected=observe();
    return {ready,expired,pollCount,repeatedPollCount,recovered,pendingPolls,newerPush,lateGet,disconnected,
      remainingIntervals:intervals.size,requestsAttempted:resolvers.length,finalTrusted:session.readState().uiObservationTrusted};
   },{socketSource,headerSource,assessor:String(classicDashboardReadiness),initial:fixture()});
   expect(result.ready.pc).toContain('TOUT EST PRÊT');
   expect(result.expired.pc).toBe('RÉGIE À VÉRIFIER');
   expect(result.expired.actions).not.toContain('data-command');
   expect(result.pollCount).toBe(1);
   expect(result.repeatedPollCount).toBe(1);
   expect(result.recovered.pc).toContain('TOUT EST PRÊT');
   expect(result.pendingPolls).toBe(1);
   expect(result.newerPush.pc).not.toContain('TOUT EST PRÊT');
   expect(result.lateGet.pc).not.toContain('TOUT EST PRÊT');
   expect(result.disconnected.pc).toBe('RÉGIE À VÉRIFIER');
   expect(result.remainingIntervals).toBe(0);
   expect(result.finalTrusted).toBe(false);
   expect(requests).toEqual([]);
  }finally{await browser.close()}
 },30000);
