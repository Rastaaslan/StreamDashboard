import {afterEach,expect,it,vi} from 'vitest';
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
// @ts-expect-error Browser JS is checked separately by check:browser-types.
import {renderSettings} from '../apps/mobile/control/settings-view.js';

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
function render({server='https://fixe.example:48136',online=true,role='mobile',nativeOverride,statuses={},observedAt=new Date().toISOString(),tab='integrations'}:{
 server?:string;online?:boolean;role?:'mobile'|'control'|'stream';nativeOverride?:boolean;statuses?:Record<string,string>;observedAt?:string|null;tab?:'integrations'|'platforms'
}={}){
 const data={host:{hostname:'FIXE',settingsRevision:'1',settings:{},state:{
  at:observedAt,
  obs:{inputs:{},scenes:[]},google:{connected:true},twitch:{connected:true},
  controlHub:{integrations:Object.fromEntries(Object.entries(statuses).map(([key,status])=>[key,{status}]))}
 }},configuration:{revision:1,outputs:{twitch:{kind:'unconfigured',name:''}}}};
 return renderSettings({data,server,online,native:nativeOverride??role==='mobile',tab,device:{role,name:'Test'},
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
it('fails closed on missing, expired or implausibly future host observations even when online',()=>{
 const statuses={discord:'CONNECTED',streamlabs:'CONNECTED',wizebot:'CONNECTED'};
 for(const observedAt of [null,'invalid',new Date(Date.now()-120_000).toISOString(),new Date(Date.now()+120_000).toISOString()]){
  const html=render({online:true,observedAt,statuses});
  for(const id of Object.keys(statuses)){
   expect(html).toMatch(new RegExp('data-integration-status="'+id+'"[^>]*>[^<]*périmé','i'));
   expect(html).not.toMatch(new RegExp('data-integration-status="'+id+'"[^>]*>[^<]*: connecté','i'));
  }
 }
 expect(render({statuses})).toMatch(/data-integration-status="discord"[^>]*>[^<]*connecté/i);
});
it('Twitch account status is never presented as connected on an offline or stale FIXE',()=>{
 const stale=new Date(Date.now()-120_000).toISOString();
 const offline=render({tab:'platforms',role:'control',online:false});
 const expired=render({tab:'platforms',role:'control',observedAt:stale});
 const unpaired=render({tab:'platforms',role:'stream',server:'',online:false});
 for(const html of [offline,expired,unpaired]){
  expect(html).toMatch(/compte Twitch/i);
  expect(html).toMatch(/non vérifiable|non joignable|périmé/i);
  expect(html).not.toContain('Twitch de la régie sélectionnée : connecté');
 }
 const fresh=render({tab:'platforms',role:'control'});
 expect(fresh).toMatch(/Compte Twitch de la régie connecté/i);
 expect(fresh).toMatch(/droits|autorisations/i);
});
it('does not offer host-only Discord or WizeBot configuration without reachable FIXE',()=>{
 for(const options of [
  {server:'',online:false,role:'mobile' as const},
  {server:'',online:false,role:'control' as const},
  {server:'https://fixe.example:48136',online:false,role:'mobile' as const}
 ]){
  const html=render(options);
  expect(html).toContain('data-host-integrations-hint');
  expect(html).toContain('data-task="discord" disabled');
  expect(html).toContain('data-task="wizebot-catalog" disabled');
  expect(html).toContain('data-task="connection"');
  // Only host-dependent controls are gated: local Google and Streamlabs remain visible.
  expect(html).toContain('data-task="google-connect"');
  expect(html).toContain('data-task="streamlabs"');
  expect(html).not.toContain('data-task="streamlabs" disabled');
 }
 for(const options of [
  {server:'https://fixe.example:48136',online:true,role:'mobile' as const},
  {server:'http://127.0.0.1:48133',online:true,role:'stream' as const}
 ]){
  const html=render(options);
  expect(html).toContain('data-task="discord"');
  expect(html).not.toContain('data-task="discord" disabled');
  expect(html).not.toContain('data-task="wizebot-catalog" disabled');
  expect(html).not.toContain('data-host-integrations-hint');
 }
});
it.skipIf(process.env.SC3_SETTINGS_BROWSER_TEST!=='1')('real Edge 320 px shows disabled host-only integrations on offline Android without side effects',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:760},hasTouch:true});
  const network:string[]=[],errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{network.push(route.request().url());return route.abort()});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main>'+render({server:'',online:false,role:'mobile'})+'</main>');
  await page.addStyleTag({content:readFileSync('apps/mobile/control/control.css','utf8')});
  expect(await page.locator('[data-task="discord"]').isDisabled()).toBe(true);
  expect(await page.locator('[data-task="wizebot-catalog"]').isDisabled()).toBe(true);
  expect(await page.locator('[data-task="streamlabs"]').isEnabled()).toBe(true);
  expect(await page.locator('[data-task="connection"]').isEnabled()).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(network).toEqual([]);expect(errors).toEqual([]);
 }finally{await browser.close()}
},25000);
it('stale FIXE observations cannot authorize host-only Discord/WizeBot settings even when transport says online',()=>{
 for(const observedAt of [null,new Date(Date.now()-120_000).toISOString(),new Date(Date.now()+120_000).toISOString()]){
  const html=render({server:'https://fixe.example:48136',online:true,role:'mobile',observedAt,
   statuses:{discord:'CONNECTED',wizebot:'CONNECTED'}});
  expect(html).toContain('data-host-integrations-hint');
  expect(html).toMatch(/data-host-integrations-hint[^>]*>[^<]*périmé/i);
  expect(html).toContain('data-task="discord" disabled');
  expect(html).toContain('data-task="wizebot-catalog" disabled');
  expect(html).toContain('data-task="google-connect"');
  expect(html).toContain('data-task="streamlabs"');
 }
 const fresh=render({server:'https://fixe.example:48136',online:true,role:'mobile'});
 expect(fresh).not.toContain('data-host-integrations-hint');
 expect(fresh).not.toContain('data-task="discord" disabled');
});
it.skipIf(process.env.SC3_SETTINGS_BROWSER_TEST!=='1')('real Edge 320px does not expose privileged provider config from a stale FIXE snapshot',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:760},hasTouch:true});
  const requests:string[]=[];const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main>'+
   render({online:true,observedAt:new Date(Date.now()-120_000).toISOString(),statuses:{discord:'CONNECTED',wizebot:'CONNECTED'}})+'</main>');
  await page.addStyleTag({content:readFileSync('apps/mobile/control/control.css','utf8')});
  expect(await page.locator('[data-task="discord"]').isDisabled()).toBe(true);
  expect(await page.locator('[data-task="wizebot-catalog"]').isDisabled()).toBe(true);
  expect(await page.locator('[data-host-integrations-hint]').innerText()).toMatch(/périmé/i);
  expect(await page.locator('[data-task="google-connect"]').isEnabled()).toBe(true);
  expect(requests).toEqual([]); expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
 }finally{await browser.close()}
},25000);
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
  const stale=render({online:true,observedAt:new Date(Date.now()-120_000).toISOString(),
   statuses:{discord:'CONNECTED',streamlabs:'CONNECTED',wizebot:'CONNECTED'}});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main>'+stale+'</main>');
  for(const key of ['discord','streamlabs','wizebot']){
   expect(await page.locator('[data-integration-status="'+key+'"]').innerText()).toContain('périmé');
  }
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main>'+render({
   tab:'platforms',online:true,observedAt:new Date(Date.now()-120_000).toISOString()
  })+'</main>');
  expect(await page.locator('[data-twitch-account-status]').innerText()).toContain('périmé');
  expect(await page.locator('[data-twitch-account-status]').innerText()).not.toContain('régie connecté');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(network).toEqual([]);expect(errors).toEqual([]);
  await page.close();
 }finally{await browser.close()}
},25000);

// A stale persisted 'stream' role on a native Android is never FIXE authority.
it('fails closed for an unpaired native Android with a stale stream role, even when its local runtime responds',()=>{
 const html=render({server:'',online:true,role:'stream',nativeOverride:true,
  statuses:{discord:'CONNECTED',streamlabs:'CONNECTED',wizebot:'CONNECTED'}});
 expect(html).toContain('data-host-integrations-hint');
 expect(html).toContain('data-task="discord" disabled');
 expect(html).toContain('data-task="wizebot-catalog" disabled');
 expect(html).toContain('data-task="connection">Associer FIXE</button>');
 for(const provider of ['discord','wizebot','streamlabs']) {
  expect(html).toMatch(new RegExp('data-integration-status="'+provider+'"[^>]*>[^<]*(inconnu|non vérifiable)','i'));
  expect(html).not.toMatch(new RegExp('data-integration-status="'+provider+'"[^>]*>[^<]*: connecté','i'));
 }
 expect(html).toContain('data-task="google-connect"');
 expect(html).toContain('data-task="streamlabs"');
});

it.skipIf(process.env.SC3_SETTINGS_BROWSER_TEST!=='1')('real Edge 320 px refuses Android stale-master host integration controls without network effects',async()=>{
 const html=render({server:'',online:true,role:'stream',nativeOverride:true,
  statuses:{discord:'CONNECTED',streamlabs:'CONNECTED',wizebot:'CONNECTED'}});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:320,height:770},hasTouch:true});
  const network:string[]=[],errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{network.push(route.request().url());return route.abort()});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main>'+html+'</main>');
  await page.addStyleTag({content:readFileSync('apps/mobile/control/control.css','utf8')});
  expect(await page.locator('[data-task="discord"]').isDisabled()).toBe(true);
  expect(await page.locator('[data-task="wizebot-catalog"]').isDisabled()).toBe(true);
  expect(await page.locator('[data-task="connection"]').isEnabled()).toBe(true);
  expect(await page.locator('[data-integration-status="discord"]').innerText()).toContain('inconnu');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(network).toEqual([]);expect(errors).toEqual([]);
 }finally{await browser.close()}
},30000);

it('stale or offline selected FIXE has one explicit refresh action without OAuth reconnection',()=>{
 const stale=new Date(Date.now()-120_000).toISOString();
 for(const html of [
  render({server:'https://fixe.example:48136',online:true,observedAt:stale}),
  render({server:'https://fixe.example:48136',online:false})
 ]){
  expect(html).toContain('data-host-integrations-hint');
  expect(html.match(/data-task="refresh-live"/g)).toHaveLength(1);
  expect(html).toContain('Actualiser l’état de FIXE');
  expect(html).toContain('data-task="discord" disabled');
  expect(html).toContain('data-task="wizebot-catalog" disabled');
 }
 for(const html of [render(),render({server:'',online:false})])
  expect(html).not.toContain('data-task="refresh-live"');
});
it.skipIf(process.env.SC3_SETTINGS_BROWSER_TEST!=='1')('real Edge 320px provides a refresh affordance but no accidental OAuth or network request',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:760},hasTouch:true});
  const network:string[]=[],errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{network.push(route.request().url());return route.abort()});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main>'+
   render({server:'https://fixe.example:48136',online:true,observedAt:new Date(Date.now()-120_000).toISOString()})+'</main>');
  await page.addStyleTag({content:readFileSync('apps/mobile/control/control.css','utf8')});
  const refreshButton=page.locator('[data-task="refresh-live"]');
  expect(await refreshButton.count()).toBe(1);
  expect(await refreshButton.isEnabled()).toBe(true);
  expect(await page.locator('[data-task="discord"]').isDisabled()).toBe(true);
  expect(await page.locator('[data-task="wizebot-catalog"]').isDisabled()).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(network).toEqual([]);expect(errors).toEqual([]);
 }finally{await browser.close()}
},30000);
