import {afterEach,expect,it,vi} from 'vitest';
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
// @ts-expect-error Browser JS is checked separately by check:browser-types.
import {renderSettings} from '../apps/mobile/control/settings-view.js';

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
function render({server='https://fixe.example:48136',online=true,role='mobile',statuses={}}:{
 server?:string;online?:boolean;role?:'mobile'|'control'|'stream';statuses?:Record<string,string>
}={}){
 const data={host:{hostname:'FIXE',settingsRevision:'1',settings:{},state:{
  obs:{inputs:{},scenes:[]},google:{connected:true},twitch:{connected:true},
  controlHub:{integrations:Object.fromEntries(Object.entries(statuses).map(([key,status])=>[key,{status}]))}
 }},configuration:{revision:1,outputs:{twitch:{kind:'unconfigured',name:''}}}};
 return renderSettings({data,server,online,native:role==='mobile',tab:'integrations',device:{role,name:'Test'},
   localEndpoint:'',deviceExecutor:false,installation:{devices:[]},macroConfigurationError:'',
   knownPairedServer:'',esc,input:()=>'',select:()=>'',check:()=>''});
}
afterEach(()=>vi.unstubAllGlobals());
it('shows distinct verified provider statuses from the selected, reachable FIXE snapshot',()=>{
 const html=render({statuses:{discord:'CONNECTED',streamlabs:'NOT_CONFIGURED',wizebot:'DEGRADED'}});
 expect(html).toContain('data-integration-status="discord"');
 expect(html).toContain('data-integration-status="streamlabs"');
 expect(html).toContain('data-integration-status="wizebot"');
 expect(html).toMatch(/data-integration-status="discord"[^>]*>[^<]*connecté/i);
 expect(html).toMatch(/data-integration-status="streamlabs"[^>]*>[^<]*non configuré/i);
 expect(html).toMatch(/data-integration-status="wizebot"[^>]*>[^<]*dégradé/i);
 expect(html).toContain('commande dans le chat');
});
it('refuses stale CONNECTED states while FIXE is offline or the client has no paired host',()=>{
 for(const html of [
  render({online:false,statuses:{discord:'CONNECTED',streamlabs:'CONNECTED',wizebot:'CONNECTED'}}),
  render({server:'',role:'control',statuses:{discord:'CONNECTED',streamlabs:'CONNECTED',wizebot:'CONNECTED'}})
 ]){
  expect(html).toContain('data-integration-status="discord"');
  expect(html).not.toMatch(/data-integration-status="discord"[^>]*>[^<]*: connecté/i);
  expect(html).toMatch(/data-integration-status="discord"[^>]*>[^<]*(non vérifi|inconnu)/i);
 }
});
it('never copies a provider status or an unknown string into the HTML',()=>{
 const html=render({statuses:{discord:'<img src=x onerror=alert(1)>',streamlabs:'CONNECTING',wizebot:'NOT_SUPPORTED'}});
 expect(html).not.toContain('<img src=x');
 expect(html).toMatch(/data-integration-status="discord"[^>]*>[^<]*non communiqué/i);
 expect(html).toMatch(/data-integration-status="streamlabs"[^>]*>[^<]*en cours/i);
 expect(html).toMatch(/data-integration-status="wizebot"[^>]*>[^<]*non pris en charge/i);
});
it.skipIf(process.env.SC3_SETTINGS_BROWSER_TEST!=='1')('real Edge 320 px shows unknown statuses on an offline Android client without network actions',async()=>{
 const html=render({online:false,statuses:{discord:'CONNECTED',streamlabs:'CONNECTED',wizebot:'CONNECTED'}});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:320,height:770},hasTouch:true});
  const network:string[]=[],errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{network.push(route.request().url());return route.abort()});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main>'+html+'</main>');
  await page.addStyleTag({content:readFileSync('apps/mobile/control/control.css','utf8')});
  for(const key of ['discord','streamlabs','wizebot']){
   expect(await page.locator('[data-integration-status="'+key+'"]').innerText()).toContain('non vérifiable');
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(network).toEqual([]);expect(errors).toEqual([]);
  await page.close();
 }finally{await browser.close()}
},25000);
