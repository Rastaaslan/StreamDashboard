import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {chromium,type Browser} from '@playwright/test';
import {readFile} from 'node:fs/promises';
// @ts-ignore Native browser module has no TypeScript declarations.
import {installNativeUpdateGate} from '../apps/mobile/control/streamcockpit-native-update.js';
const id='12345678-1234-1234-1234-123456789012';
function fixture(reply:any={authority:'fixe',safe:true,observedAt:10000}){
 const events=new EventTarget(),native={updateSafety:vi.fn()},request=vi.fn(async()=>reply);
 let origin='https://fixture.test:19443',time=10000;
 const stop=installNativeUpdateGate({native,events,request,origin:()=>origin,now:()=>time});
 const dispatch=async()=>{events.dispatchEvent(new CustomEvent('native-update-safety',{detail:{id}}));await new Promise(r=>setImmediate(r))};
 return {native,request,dispatch,stop,events,origin:(s:string)=>{origin=s},time:(n:number)=>{time=n}};
}
it('uses one read-only host safety observation and never a synchronized write',async()=>{
 const f=fixture();await f.dispatch();
 expect(f.request).toHaveBeenCalledExactlyOnceWith('/api/v1/maintenance/safety');
 expect(f.native.updateSafety).toHaveBeenCalledExactlyOnceWith(id,true);
 f.stop();await f.dispatch();expect(f.request).toHaveBeenCalledOnce();
});
it.each([
 {authority:'control',safe:true,observedAt:10000},
 {authority:'fixe',safe:false,observedAt:10000},
 {authority:'fixe',safe:true,observedAt:5000},
 {authority:'fixe',safe:true,observedAt:12000},
 {authority:'fixe',safe:true},
])('unknown, live, stale, future or control-only response never permits an install: %j',async reply=>{
 const f=fixture(reply);await f.dispatch();expect(f.native.updateSafety).toHaveBeenCalledExactlyOnceWith(id,false);
});
it('binds a delayed observation to its exact selected host and times out closed',async()=>{
 const f=fixture();f.request.mockImplementationOnce(async()=>{f.origin('https://other.test:19443');return {authority:'fixe',safe:true,observedAt:10000}});
 await f.dispatch();expect(f.native.updateSafety).toHaveBeenLastCalledWith(id,false);
 f.request.mockImplementationOnce(async()=>{f.time(15000);return {authority:'fixe',safe:true,observedAt:15000}});
 await f.dispatch();expect(f.native.updateSafety).toHaveBeenLastCalledWith(id,false);
});
it('denies unavailable authority without provider retry and ignores malformed challenges',async()=>{
 const f=fixture();f.request.mockRejectedValueOnce(Error('temporary'));
 await f.dispatch();expect(f.request).toHaveBeenCalledOnce();expect(f.native.updateSafety).toHaveBeenLastCalledWith(id,false);
 f.events.dispatchEvent(new CustomEvent('native-update-safety',{detail:{id:'untrusted'}}));
 await new Promise(r=>setImmediate(r));expect(f.request).toHaveBeenCalledOnce();
});
const enabled=process.platform==='win32'&&process.env.SC3_FINAL_BROWSER_TEST==='1';
let browser:Browser;
beforeAll(async()=>{if(enabled)browser=await chromium.launch({channel:'msedge',headless:true})});
afterAll(async()=>{await browser?.close()});
(enabled?it:it.skip)('actual Edge 320px exposes native update only on the Android bridge and delivers fresh read-only consent gate',async()=>{
 const page=await browser.newPage({viewport:{width:320,height:740},hasTouch:true});
 try{
  const ui=await readFile(new URL('../apps/mobile/control/mobile-five-tab-ui.js',import.meta.url),'utf8');
  const gate=await readFile(new URL('../apps/mobile/control/streamcockpit-native-update.js',import.meta.url),'utf8');
  await page.setContent('<main style="padding:8px;overflow-wrap:anywhere" id="app"></main>');
  await page.addScriptTag({content:ui.replaceAll('export function ','function ')+'\n'+gate.replaceAll('export function ','function ')});
  const result=await page.evaluate(async()=>{
   const w=window as any,app=document.getElementById('app')!;
   const props={data:{},online:false,server:'',esc:(s:string)=>s};
   app.innerHTML=w.renderMobilePlus(props);
   const absent=app.querySelector('[data-task="native-update"]')===null;
   let opened=0;const receipts:any[]=[],requests:string[]=[];
   w.StreamDashboardNative={openUpdate:()=>{opened++},updateSafety:(...args:any[])=>receipts.push(args)};
   app.innerHTML=w.renderMobilePlus(props);
   app.querySelector('[data-task="native-update"]')!.addEventListener('click',()=>w.StreamDashboardNative.openUpdate());
   (app.querySelector('[data-task="native-update"]') as HTMLElement).click();
   w.installNativeUpdateGate({request:async(path:string)=>{requests.push(path);return {authority:'fixe',safe:true,observedAt:Date.now()}},origin:()=> 'https://test.invalid'});
   window.dispatchEvent(new CustomEvent('native-update-safety',{detail:{id:'12345678-1234-1234-1234-123456789012'}}));
   await new Promise(r=>setTimeout(r,0));
   return {absent,opened,receipts,requests,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  expect(result).toEqual({absent:true,opened:1,receipts:[[id,true]],requests:['/api/v1/maintenance/safety'],overflow:false});
 }finally{await page.close()}
});
