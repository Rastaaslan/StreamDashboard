import {expect,it,vi} from 'vitest';
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
// @ts-expect-error Browser JS is checked by check:browser-types.
import {observeHostReadOnly} from '../apps/mobile/control/read-only-host-refresh.js';
// @ts-expect-error Browser JS is checked by check:browser-types.
import {renderSettings} from '../apps/mobile/control/settings-view.js';

const esc=(x:unknown)=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const now=Date.parse('2026-11-06T09:00:00Z');
const snapshot=(at=new Date(now).toISOString(),workspace='regie-fixe')=>({workspace,bundle:{data:{host:{state:{at,obs:{connected:true},controlHub:{integrations:{discord:{status:'CONNECTED'}}}}}}}});
function staleSettings(online=true){
 const data={host:{hostname:'FIXE',settingsRevision:'1',settings:{},state:{at:new Date(Date.now()-180_000).toISOString(),obs:{inputs:{},scenes:[]},google:{connected:true},twitch:{connected:true},controlHub:{integrations:{discord:{status:'CONNECTED'},wizebot:{status:'CONNECTED'}}}}},configuration:{revision:1,outputs:{twitch:{kind:'unconfigured',name:''}}}};
 return renderSettings({data,server:'https://fixe.example:48136',online,native:true,device:{role:'mobile',name:'Android'},localEndpoint:'',tab:'integrations',deviceExecutor:false,installation:{devices:[]},macroConfigurationError:'',knownPairedServer:'',esc,input:()=>'',select:()=>'',check:()=>''});
}
it('stale host UI selects dedicated read-only refresh instead of autosync task',()=>{
 const html=staleSettings();
 expect(html).toContain('data-task="refresh-host-readonly"');
 expect(html).not.toContain('data-task="refresh-live"');
 expect(html).toContain('data-task="discord" disabled');
 expect(html).toContain('data-task="wizebot-catalog" disabled');
});
it('one explicit refresh performs a single host GET and never submits queued local changes',async()=>{
 const requests:{path:string;method:string}[]=[],pending=[{id:'draft1',key:'settings/root'}],before=structuredClone(pending);
 const accept=vi.fn(async()=>{});
 const result=await observeHostReadOnly({workspace:'regie-fixe',now:()=>now,isCurrent:()=>true,
  request:async(path:string,method:string)=>{requests.push({path,method});return snapshot();},accept});
 expect(result).toBe(true);
 expect(requests).toEqual([{path:'/api/v2/autonomy',method:'GET'}]);
 expect(accept).toHaveBeenCalledTimes(1);
 expect(pending).toEqual(before);
});
it('refuses a different workspace and invalid/stale/future timestamps without touching replica',async()=>{
 const accept=vi.fn(async()=>{});
 for(const response of [snapshot(new Date(now).toISOString(),'wrong'),snapshot('invalid'),snapshot(new Date(now-120_000).toISOString()),snapshot(new Date(now+120_000).toISOString()),{workspace:'regie-fixe',bundle:{data:{}}}]){
  await expect(observeHostReadOnly({workspace:'regie-fixe',now:()=>now,isCurrent:()=>true,request:async()=>response,accept})).rejects.toThrow();
 }
 expect(accept).not.toHaveBeenCalled();
});
it('late GET cannot apply a prior host observation after a workspace switch',async()=>{
 let resolveRequest:(value:ReturnType<typeof snapshot>)=>void=()=>{};
 const pending=new Promise<ReturnType<typeof snapshot>>(resolve=>resolveRequest=resolve),accept=vi.fn(async()=>{});
 let current=true;
 const refresh=observeHostReadOnly({workspace:'regie-fixe',now:()=>now,isCurrent:()=>current,request:async()=>pending,accept});
 current=false;resolveRequest(snapshot());
 expect(await refresh).toBe(false);
 expect(accept).not.toHaveBeenCalled();
});
it.skipIf(process.env.SC3_AUDIT_BROWSER_TEST!=='1')('Edge 320px shows a single read-only refresh entry and keeps risky settings disabled',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:780},hasTouch:true});
  const requests:string[]=[];await page.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main>'+staleSettings()+'</main>');
  await page.addStyleTag({content:readFileSync('apps/mobile/control/control.css','utf8')});
  expect(await page.locator('[data-task="refresh-host-readonly"]').count()).toBe(1);
  expect(await page.locator('[data-task="discord"]').isDisabled()).toBe(true);
  expect(await page.locator('[data-task="wizebot-catalog"]').isDisabled()).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(requests).toEqual([]);
 }finally{await browser.close()}
},30000);
