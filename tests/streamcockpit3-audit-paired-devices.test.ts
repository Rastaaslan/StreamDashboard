import {expect,it} from 'vitest';
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
// @ts-expect-error JavaScript UI module is checked by the browser type project.
import {renderDevicesSettings} from '../apps/mobile/control/settings-simplified.js';
// @ts-expect-error JavaScript UI module is checked by the browser type project.
import {renderPairedDevicesSummary} from '../apps/mobile/control/paired-devices-summary.js';

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
function devicesSettings(role:'stream'|'control'|'mobile'='stream',nativeAgent=false){
 const native=role==='mobile';
 return renderDevicesSettings({
  data:{host:{hostname:'FIXE',local:role==='stream'}},device:{role,name:role==='stream'?'FIXE':native?'Téléphone':'Laptop'},
  installation:{preset:'single-pc',localDeviceId:'fixe',devices:[{id:'fixe',name:'FIXE',platform:'windows',enabled:true,roles:['controller']}]},
  native,server:role==='stream'?'http://127.0.0.1:48133':native?'':'https://fixe.invalid:48136',online:!native,
  localEndpoint:role==='stream'?'http://127.0.0.1:48133':native?'':'http://127.0.0.1:48135',
  deviceExecutor:nativeAgent?{}:null,macroConfigurationError:'',knownPairedServer:'',esc
 });
}

it('FIXE separates local install model from read-only actual pairing list',()=>{
 const html=devicesSettings();
 expect(html).toContain('Mono-PC Windows');
 expect(html).toContain('Non déclaré dans cette installation (modèle local uniquement)');
 expect(html).toContain('Le modèle local ne recense pas les télécommandes déjà associées');
 expect(html).toContain('data-task="paired-devices"');
 expect(html).toContain('Voir les appareils associés à FIXE');
 expect(html).not.toContain('Android connecté');
});
it('a laptop cannot open the host-only actual pairing listing from Settings',()=>{
 expect(devicesSettings('control')).not.toContain('data-task="paired-devices"');
});
it('FIXE offers one pairing action and no second-regie association',()=>{
 const html=devicesSettings('stream');
 expect(html.match(/data-task="pairing"/g)||[]).toHaveLength(1);
 expect(html.match(/data-task="connection"/g)||[]).toHaveLength(0);
 expect(html).toContain('data-task="local-permissions"');
 expect(html).toContain('data-task="transport"');
 expect(html).toContain('data-task="paired-devices"');
});
it('laptop offers one association with FIXE and cannot become a pairing host',()=>{
 const html=devicesSettings('control');
 expect(html.match(/data-task="connection"/g)||[]).toHaveLength(1);
 expect(html).not.toContain('data-task="pairing"');
});
it('Android retains its one FIXE connection entry, and local-agent pairing remains optional',()=>{
 const client=devicesSettings('mobile');
 expect(client.match(/data-task="connection"/g)||[]).toHaveLength(1);
 expect(client).not.toContain('data-task="pairing"');
 const localAgent=devicesSettings('mobile',true);
 expect(localAgent.match(/data-task="connection"/g)||[]).toHaveLength(1);
 expect(localAgent.match(/data-task="pairing"/g)||[]).toHaveLength(1);
 expect(localAgent).toContain('data-task="local-permissions"');
});
it.skipIf(process.env.SC3_AUDIT_BROWSER_TEST!=='1')('real Edge 320px keeps a single association route per FIXE, laptop and Android profile',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  for(const role of ['stream','control','mobile'] as const){
   const page=await browser.newPage({viewport:{width:320,height:780},hasTouch:true});
   const requests:string[]=[];
   await page.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
   await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main>'+devicesSettings(role)+'</main>');
   await page.addStyleTag({content:readFileSync('apps/mobile/control/control.css','utf8')});
   expect(await page.locator('[data-task="pairing"]').count()).toBe(role==='stream'?1:0);
   expect(await page.locator('[data-task="connection"]').count()).toBe(role==='stream'?0:1);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
   expect(requests).toEqual([]);
   await page.close();
  }
 }finally{await browser.close();}
},30000);
it('paired-device view never claims online status or exposes credentials or ids',()=>{
 const rows=[
  {name:'<img src=x onerror=alert(1)>',id:'private-identifier',token:'private-token',permissions:['obs.write'],lastSeenAt:'2026-11-05T21:45:00.000Z'},
  {name:'Ancien appareil',id:'revoked-device',revokedAt:'2026-11-05T21:46:00.000Z'},
  {name:'En attente',lastSeenAt:'2999-01-01T00:00:00Z'}
 ];
 const html=renderPairedDevicesSummary(rows,esc,Date.parse('2026-11-06T00:00:00Z'));
 expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
 expect(html).toContain('2 association(s)');
 expect(html).toContain('Dernier contact non vérifiable');
 expect(html).not.toContain('<img src=x');
 expect(html).not.toContain('private-token');
 expect(html).not.toContain('private-identifier');
 expect(html).not.toContain('obs.write');
 expect(html).not.toContain('Ancien appareil');
 expect(html).not.toContain('en ligne : oui');
});
it('malformed pairing responses fail closed without inventing devices',()=>{
 expect(()=>renderPairedDevicesSummary({devices:[]},esc)).toThrow(/Liste des appareils/);
 expect(renderPairedDevicesSummary([],esc)).toContain('Aucune télécommande associée');
});
it.skipIf(process.env.SC3_AUDIT_BROWSER_TEST!=='1')('real Edge 320px shows the pairings check without a second OBS master or network side effects',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:320,height:780},hasTouch:true});
  const requests:string[]=[];
  await page.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main>'+devicesSettings()+'</main>');
  await page.addStyleTag({content:readFileSync('apps/mobile/control/control.css','utf8')});
  expect(await page.locator('[data-task="paired-devices"]').count()).toBe(1);
  expect(await page.locator('[data-device-kind="master"]').innerText()).toContain('Régie de cet ordinateur');
  expect(await page.locator('[data-device-kind="android"]').innerText()).toContain('modèle local uniquement');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(requests).toEqual([]);
 } finally {await browser.close()}
},30000);
