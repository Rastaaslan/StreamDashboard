import {expect,it} from 'vitest';
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
// @ts-expect-error browser JS is checked by check:browser-types.
import {classicDashboardReadiness} from '../apps/web/classic-readiness.js';

const source=readFileSync('apps/web/app.js','utf8');
function extract(start:string,end:string){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 expect(a).toBeGreaterThanOrEqual(0);expect(b).toBeGreaterThan(a);
 return source.slice(a,b);
}
const headerSource=extract('function updateHeader() {','\nfunction dirtyForm() {');
const prepareSource=extract('function preflightBlock() {','\nfunction preparation() {');
const socketSource=extract('function socket() {','\nnav();');

const fixture=()=>({runtime:true,obs:{connected:true,streaming:false,streamingKnown:true},twitch:{connected:true},uiObservationTrusted:true,
 preflight:{status:'ready'},checklist:[{done:true,label:'Micro',id:'micro'}],
 settings:{startMode:'intro',timerBrowserSource:''},timer:{}});
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,'');
it('a previously ready or live snapshot becomes UNKNOWN after transport verification is revoked',()=>{
 const ready=fixture();
 expect(classicDashboardReadiness(ready)).toEqual({ready:true,live:false});
 expect(classicDashboardReadiness({...ready,uiObservationTrusted:false})).toEqual({ready:false,live:false});
 const live={...ready,obs:{...ready.obs,streaming:true}};
 expect(classicDashboardReadiness(live)).toEqual({ready:false,live:true});
 expect(classicDashboardReadiness({...live,uiObservationTrusted:false})).toEqual({ready:false,live:false});
});
it('legacy preparation and header do not offer a start command or claim current OBS/Twitch on an unverified snapshot',()=>{
 const state={...fixture(),uiObservationTrusted:false};
 const fields=new Map<string,{textContent:string;className:string;hidden:boolean;innerHTML:string}>();
 for(const id of ['#pc-pill','#obs-pill','#twitch-pill','#live-pill','#quick-actions'])
  fields.set(id,{textContent:'',className:'',hidden:false,innerHTML:''});
 new Function('state','classicDashboardReadiness','$',headerSource+'\nupdateHeader()')(state,classicDashboardReadiness,(id:string)=>fields.get(id));
 expect(fields.get('#pc-pill')!.textContent).toBe('RÉGIE À VÉRIFIER');
 expect(fields.get('#obs-pill')!.textContent).toBe('OBS NON VÉRIFIÉ');
 expect(fields.get('#twitch-pill')!.textContent).toBe('TWITCH NON VÉRIFIÉ');
 expect(fields.get('#live-pill')!.textContent).toBe('ÉTAT INCONNU');
 expect(fields.get('#quick-actions')!.innerHTML).not.toContain('data-command');
 const html=new Function('state','classicDashboardReadiness','esc','duration','timerRemaining',
  prepareSource+'\nreturn prepare()')(state,classicDashboardReadiness,esc,()=> '00:00',()=>0) as string;
 expect(html).not.toContain('id="prepare-status">Tout est prêt');
 expect(html).toContain('État OBS non vérifié');
 expect(html).toMatch(/<button class="primary" disabled data-command="session.start">/);
});
it.skipIf(process.env.SC3_AUDIT_BROWSER_TEST!=='1')('real Edge 320px fails closed after WS loss, ignores delayed GET, restores only after fresh GET',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:780},hasTouch:true});
  const requests:string[]=[];await page.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="socket"></div><span id="pc-pill"></span><span id="obs-pill"></span><span id="twitch-pill"></span><span id="live-pill"></span><section id="quick-actions"></section>');
  const result=await page.evaluate(async ({socketSource,headerSource,assessor,fixture})=>{
   const sockets:any[]=[],timers:(()=>void)[]=[],resolvers:((value:unknown)=>void)[]=[];
   class FakeWebSocket {
    static OPEN=1;
    readyState=0;
    onopen?:()=>void;onclose?:()=>void;onerror?:()=>void;onmessage?:(event:{data:string})=>void;
    constructor(_url:string){sockets.push(this)}
    open(){this.readyState=1;this.onopen?.()}
    close(){this.readyState=3;this.onclose?.()}
    emit(payload:unknown){this.onmessage?.({data:JSON.stringify(payload)})}
   }
   const readiness=new Function('return ('+assessor+')')();
   new Function('FakeWebSocket','readiness','initial','headerSource','socketSource','request','setTimeoutFake',`
    let activeSocket,socketTrusted=false,state={...initial,uiObservationTrusted:false};
    const $=id=>document.querySelector(id);
    const location={protocol:'http:',host:'test.invalid'};
    const WebSocket=FakeWebSocket;
    const setTimeout=setTimeoutFake;
    const classicDashboardReadiness=readiness;
    function toast(){}
    function updateHeader(){new Function('state','classicDashboardReadiness','$',headerSource+'\\nupdateHeader()')(state,classicDashboardReadiness,$)}
    function render(){updateHeader()}
    function applyStateUpdate(next){state={...next,uiObservationTrusted:socketTrusted};render()}
    ${socketSource}
    render();socket();return {readState:()=>state};
   `)(FakeWebSocket,readiness,fixture,headerSource,socketSource,
      ()=>new Promise(resolve=>resolvers.push(resolve)),(cb:()=>void)=>{timers.push(cb)});
   const observed=()=>({pc:document.querySelector('#pc-pill')?.textContent,obs:document.querySelector('#obs-pill')?.textContent,
    live:document.querySelector('#live-pill')?.textContent,actions:document.querySelector('#quick-actions')?.innerHTML});
   const initial=observed();sockets[0].open();
   sockets[0].emit({type:'state.updated',data:fixture});
   const trusted=observed();
   sockets[0].close();
   const lost=observed();
   resolvers[0](fixture);await Promise.resolve();await Promise.resolve();
   const afterLateGet=observed();
   timers[0]();sockets[1].open();
   const reconnectUnverified=observed();
   resolvers[1](fixture);await Promise.resolve();await Promise.resolve();
   const verifiedAgain=observed();
   return {initial,trusted,lost,afterLateGet,reconnectUnverified,verifiedAgain,count:sockets.length};
  },{socketSource,headerSource,assessor:String(classicDashboardReadiness),fixture:fixture()});
  expect(result.count).toBe(2);
  expect(result.initial.pc).toBe('RÉGIE À VÉRIFIER');
  expect(result.trusted.pc).toContain('TOUT EST PRÊT');
  expect(result.lost.pc).toBe('RÉGIE À VÉRIFIER');
  expect(result.lost.obs).toBe('OBS NON VÉRIFIÉ');
  expect(result.lost.live).toBe('ÉTAT INCONNU');
  expect(result.lost.actions).not.toContain('data-command');
  expect(result.afterLateGet.pc).toBe('RÉGIE À VÉRIFIER');
  expect(result.reconnectUnverified.pc).toBe('RÉGIE À VÉRIFIER');
  expect(result.verifiedAgain.pc).toContain('TOUT EST PRÊT');
  expect(requests).toEqual([]);
 }finally{await browser.close()}
},30000);
