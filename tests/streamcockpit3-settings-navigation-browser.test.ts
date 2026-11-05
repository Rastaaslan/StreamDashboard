import {expect,it,vi,afterEach} from 'vitest';
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
// @ts-expect-error Browser JS module separately checked by check:browser-types.
import {renderSettings} from '../apps/mobile/control/settings-view.js';
// @ts-expect-error Browser JS module separately checked by check:browser-types.
import {settingsCategories,settingsCategory} from '../apps/mobile/control/settings-navigation.js';
// @ts-expect-error Browser JS module separately checked by check:browser-types.
import {renderMobilePlus} from '../apps/mobile/control/mobile-five-tab-ui.js';

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const input=(label:string,name:string,value:unknown='')=>`<label>${esc(label)}<input name="${esc(name)}" value="${esc(value)}"></label>`;
const select=(label:string,name:string,items:[string,string][],value:string)=>`<label>${esc(label)}<select name="${esc(name)}">${items.map(([id,text])=>`<option value="${esc(id)}" ${id===value?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
const check=(label:string,name:string,checked:boolean)=>`<label>${esc(label)}<input type="checkbox" name="${esc(name)}" ${checked?'checked':''}></label>`;

function fixture(options:{role?:'control'|'stream'|'mobile';server?:string;online?:boolean;tab?:string;compact?:boolean}={}) {
 const role=options.role||'control',native=role==='mobile';
 const server=options.server||'',online=options.online||false,compact=options.compact??native;
 const installation={preset:'dual-pc-deck',localDeviceId:'pc-one',devices:[
   {id:'pc-one',name:'Le laptop',platform:native?'android':'windows',enabled:true,roles:role==='stream'?['controller','obs-executor']:['controller'],capabilities:role==='stream'?['obs','clips']:['audio','planning']},
 ],routes:{obs:'pc-one'}};
 const data={host:{hostname:server||role==='stream'?'FIXE':'Laptop-damien',settingsRevision:'rev1',settings:{
  obsUrl:'ws://127.0.0.1:4555',obsPasswordSet:true,modeScenes:{intro:'INTRO',live:'JEU',pause:'PAUSE',end:'FIN'},chattingScene:'CHATTING',primaryMicInput:'Micro',startMode:'intro',
  remoteEnabled:true,streamerName:'QA',accent:'violet',confirmStop:true,tagPreferences:{},streamerPingRewardIds:[],
 },state:{at:new Date().toISOString(),obs:{connected:false,inputs:{},scenes:[]},google:{connected:false},twitch:{connected:false}}},configuration:{revision:1,outputs:{twitch:{kind:'unconfigured',name:''}}}};
 return {
  render:(tab=options.tab||'overview')=>renderSettings({data,native,server,tab,online,compact,device:{role,name:role==='stream'?'FIXE':'Laptop-damien'},localEndpoint:role==='stream'?'http://127.0.0.1:48133':'',deviceExecutor:false,knownPairedServer:'',installation,macroConfigurationError:'',esc,input,select,check}),
  data
 };
}
afterEach(()=>vi.unstubAllGlobals());
it('Android Plus retains five main destinations and exposes Settings + Appareils & Deck shortcuts',()=>{
 const html=renderMobilePlus({data:{host:{hostname:'FIXE',chat:{connected:false,canSend:false}}},online:false,server:'',esc});
 expect(html).toContain('data-page="settings"');
 expect(html).toContain('data-settings-tab="devices"');
 expect(html).not.toContain('data-action="live.start"');
 const shell=readFileSync('apps/mobile/control/index.html','utf8');
 const nav=shell.split('<nav aria-label="Navigation principale">')[1]?.split('</nav>')[0]||'';
 for(const page of ['home','live','sounds','planning','plus'])expect(nav).toContain('data-page="'+page+'"');
 expect(nav).toContain('data-page="settings"');
 expect(nav).toContain('>Paramètres</span>');
 expect(readFileSync('apps/mobile/control/control.js','utf8')).toContain("if(b.dataset.settingsTab)");
});
it('Android local settings overview presents only meaningful categories, no duplicate OBS owner',()=>{
 vi.stubGlobal('localStorage',{getItem:()=>null});
 const html=fixture({role:'mobile',compact:true}).render();
 expect(settingsCategories({native:true,server:''}).map((x:{id:string})=>x.id)).toEqual(['devices','platforms','integrations','profile']);
 expect(settingsCategory('obs',{native:true,server:''})).toBeNull();
 expect(settingsCategory('platforms',{native:true,server:''})?.group).toBe('Comptes et services');
 expect(html).toContain('data-settings-overview');
 expect(html).toContain('Retour à Plus');
 expect(html).toContain('Appareils &amp; Deck');
 expect(html).not.toContain('data-tab="obs"');
 expect(html).not.toContain('id="settings-form"');
 expect(html).toContain('Changer de rubrique ne modifie aucune connexion');
});
it('Windows administration shows a settings overview with OBS + Android Deck instead of duplicating Android navigation',()=>{
 vi.stubGlobal('localStorage',{getItem:()=>null});
 const html=fixture({role:'stream',server:'http://127.0.0.1:48133',online:true,compact:false}).render();
 expect(html).toContain('data-settings-overview');
 expect(html).toContain('data-settings-group="Régie"');
 expect(settingsCategory('profile',{server:'http://127.0.0.1:48133'})?.group).toBe('Régie');
 expect(html).toContain('data-settings-group="Appareils"');
 expect(html).toContain('data-tab="obs"');
 expect(html).not.toContain('Retour à Plus');
 expect(html).not.toContain('id="settings-form"');
 expect(html).not.toContain('data-action="live.start"');
});
it('direct settings access retains OBS, Twitch and Google forms and does not duplicate any authority',()=>{
 vi.stubGlobal('localStorage',{getItem:()=>null});
 const f=fixture({role:'stream',server:'http://127.0.0.1:48133',online:true});
 const obs=f.render('obs');expect(obs).toContain('id="settings-form"');
 for(const field of ['obsUrl','obsPassword','primaryMicInput','scene-intro','scene-live','scene-pause','scene-end','chattingScene'])expect(obs).toContain('name="'+field+'"');
 expect(obs).toContain('value="INTRO" selected');
 const twitch=f.render('platforms');expect(twitch).toContain('id="platform-form"');
 const integrations=f.render('integrations');expect(integrations).toContain('Google Calendar');
 const profile=f.render('profile');expect(profile).toContain('Cet appareil');expect(profile).toContain('Ce formulaire modifie les réglages de la régie sélectionnée');
 const devices=f.render('devices');expect(devices).toContain('Android Deck');
 expect(devices).toContain('Le modèle décrit une organisation prévue');
});
it('selected FIXE Google account is not shown as connected from a stale offline snapshot',()=>{
 vi.stubGlobal('localStorage',{getItem:()=>null});
 const stale=fixture({role:'mobile',server:'https://FIXE.test:48136',online:false});
 stale.data.host.state.google.connected=true;
 const offline=stale.render('integrations');
 expect(offline).toContain('Régie indisponible : état du compte Google non vérifiable.');
 expect(offline).toContain('Régie sélectionnée hors ligne : configuration distante non vérifiée.');
 expect(offline).not.toContain('Compte Google de la régie connecté');
 expect(offline).not.toContain('Compte Google de la régie non connecté');
 const live=fixture({role:'mobile',server:'https://FIXE.test:48136',online:true});
 live.data.host.state.google.connected=true;
 expect(live.render('integrations')).toContain('Compte Google de la régie connecté');
 live.data.host.state.google.connected=false;
 expect(live.render('integrations')).toContain('Compte Google de la régie non connecté');
});
it('does not present an unverified Google account as connected when the host timestamp is stale or absent',()=>{
 const f=fixture({role:'mobile',server:'https://FIXE.test:48136',online:true});
 f.data.host.state.google.connected=true;
 for(const at of ['', 'bad', new Date(Date.now()-120_000).toISOString(), new Date(Date.now()+120_000).toISOString()]){
  f.data.host.state.at=at;
  const html=f.render('integrations');
  expect(html).toContain('compte Google non vérifiable');
  expect(html).not.toContain('Compte Google de la régie connecté');
 }
 f.data.host.state.at=new Date().toISOString();
 Object.assign(f.data.host.state,{google:undefined});
 expect(f.render('integrations')).toContain('État du compte Google non communiqué par FIXE.');
});
it.skipIf(process.env.SC3_SETTINGS_BROWSER_TEST!=='1')('real Edge 320px shows Google host connection as unknown while FIXE is offline',async()=>{
 vi.stubGlobal('localStorage',{getItem:()=>null});
 const f=fixture({role:'mobile',server:'https://FIXE.test:48136',online:false});
 f.data.host.state.google.connected=true;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:780},hasTouch:true});
  const network:string[]=[];
  await page.route('**/*',route=>{network.push(route.request().url());return route.abort()});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root">'+f.render('integrations')+'</main>');
  await page.addStyleTag({content:readFileSync('apps/mobile/control/control.css','utf8')});
  expect(await page.locator('.config-panel section:first-of-type [role="status"]').innerText()).toContain('Régie indisponible : état du compte Google non vérifiable.');
  expect(await page.getByText('Compte Google de la régie connecté',{exact:false}).count()).toBe(0);
  const stale=fixture({role:'mobile',server:'https://FIXE.test:48136',online:true});
  stale.data.host.state.google.connected=true;
  stale.data.host.state.at=new Date(Date.now()-120_000).toISOString();
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root">'+stale.render('integrations')+'</main>');
  expect(await page.locator('.config-panel section:first-of-type [role="status"]').innerText()).toContain('compte Google non vérifiable');
  expect(await page.getByText('Compte Google de la régie connecté',{exact:false}).count()).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(network).toEqual([]);
  await page.close();
 }finally{await browser.close()}
},20000);
it.skipIf(process.env.SC3_SETTINGS_BROWSER_TEST!=='1')('real Edge responsive settings and Android Plus shortcuts preserve navigation and accessibility',async()=>{
 vi.stubGlobal('localStorage',{getItem:()=>null});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const width of [320,390,1366]){
   const compact=width<700;
   const html=fixture({role:compact?'mobile':'stream',compact,server:'http://FIXE.test:48136',online:true}).render();
   const page=await browser.newPage({viewport:{width,height:850},hasTouch:compact});
   const errors:string[]=[],network:string[]=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>{network.push(route.request().url());return route.abort()});
   await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div class="workspace" style="margin:0;width:100%"><main id="root" style="width:100%">'+html+'</main></div>');
   await page.addStyleTag({content:readFileSync('apps/mobile/control/control.css','utf8')});
   await page.addStyleTag({content:readFileSync('apps/mobile/control/streamcockpit-mobile-v2.css','utf8')});
   expect(await page.locator('[data-settings-overview]').count()).toBe(1);
   expect(await page.locator('[data-tab="devices"]').count()).toBe(2); // nav + overview card
   expect(await page.getByRole('navigation',{name:'Rubriques des paramètres'}).count()).toBe(1);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
   expect(errors).toEqual([]);expect(network).toEqual([]);
   if(compact)expect(await page.getByRole('button',{name:'‹ Retour à Plus'}).isVisible()).toBe(true);
   await page.close();
  }
 }finally{await browser.close()}
},40000);
