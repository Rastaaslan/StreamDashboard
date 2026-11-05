import {expect,it,vi,afterEach} from 'vitest';
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
// @ts-expect-error JavaScript browser module checked independently by check:browser-types.
import {renderSettings} from '../apps/mobile/control/settings-view.js';

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const input=(label:string,name:string,value:unknown='')=>`<label>${esc(label)}<input name="${esc(name)}" value="${esc(value)}"></label>`;
const select=(label:string,name:string,items:[string,string][],value:string)=>`<label>${esc(label)}<select name="${esc(name)}">${items.map(([id,text])=>`<option value="${esc(id)}" ${id===value?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
const check=(label:string,name:string,value:boolean)=>`<label>${esc(label)}<input type="checkbox" name="${esc(name)}" ${value?'checked':''}></label>`;

function fixture(options:{role?:'control'|'stream'|'mobile';server?:string;online?:boolean;preset?:string;android?:string;obsOnline?:boolean;scenes?:string[]}={}){
 const role=options.role||'control',native=role==='mobile',server=options.server||'',online=Boolean(options.online);
 const own={id:'pc-1',name:'Laptop-damien',platform:native?'android':'windows',roles:role==='stream'?['controller','obs-executor']:['controller'],capabilities:role==='stream'?['obs','clips']:['audio','planning','chat'],enabled:true};
 const android=options.android?[{id:'phone-1',name:options.android,platform:'android',roles:['controller','display'],capabilities:['audio','chat'],enabled:true,endpoint:'https://phone.test:48136'}]:[];
 const data={host:{hostname:role==='stream'||server?'FIXE':'Laptop-damien',settingsRevision:'known-revision',
   settings:{obsUrl:'ws://127.0.0.1:4555',obsPasswordSet:false,streamerName:'QA',accent:'violet',confirmStop:true,modeScenes:{intro:'INTRO',live:'JEU',pause:'PAUSE',end:'FIN'},chattingScene:'CHATTING',primaryMicInput:'MICRO-OBS',startMode:'intro',remoteEnabled:true},
   state:{obs:{connected:Boolean(options.obsOnline),inputs: {},scenes:options.scenes||[]},google:{connected:false},twitch:{connected:false}}},
  configuration:{revision:1,outputs:{twitch:{kind:'unconfigured',name:''}}}};
 const installation={preset:options.preset||'dual-pc',localDeviceId:'pc-1',devices:[own,...android],routes:{obs:'pc-1'}};
 const render=(tab:string)=>renderSettings({data,installation,native,device:{role,name:role==='stream'?'FIXE':'Laptop-damien'},server,online,tab,localEndpoint:role==='stream'?'http://127.0.0.1:48133':'http://127.0.0.1:48135',deviceExecutor:false,knownPairedServer:'',macroConfigurationError:'',esc,input,select,check});
 return {render,installation};
}

afterEach(()=>vi.unstubAllGlobals());

it('Windows client sees distinct FIXE, laptop, Android Deck and no fake online phone',()=>{
 const html=fixture().render('devices');
 expect(html).toContain('Appareils &amp; Deck');
 expect(html).toContain('data-device-kind="master"');
 expect(html).toContain('data-device-kind="client"');
 expect(html).toContain('data-device-kind="android"');
 expect(html).toContain('Le modèle Double-PC ne l’ajoute pas automatiquement');
 expect(html).toContain('Non déclaré dans cette installation');
 expect(html).toContain('PC client : les commandes OBS et le minuteur nécessitent FIXE');
 expect(html).toContain('data-page="deck"');
 expect(html).not.toContain('data-task="pairing"'); // Laptop must not advertise a second OBS host
 expect(html).not.toContain('téléphone connecté');
});

it('Double-PC + Android Deck preset does not claim an Android is paired',()=>{
 const html=fixture({preset:'dual-pc-deck'}).render('devices');
 expect(html).toContain('Double-PC Windows + Android Deck');
 expect(html).toContain('Prévu dans le modèle, pas encore enregistré ici');
 expect(html).not.toContain('Android connecté');
});
it('Known Android appears escaped and remains unverified until hardware confirmation',()=>{
 const html=fixture({android:'<img src=x onerror=alert(1)>',preset:'dual-pc-deck'}).render('devices');
 expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
 expect(html).not.toContain('<img src=x');
 expect(html).toContain('Son état de connexion réel doit être confirmé');
});
it('FIXE presents Android pairing, retains one OBS authority, and no automatic pairing',()=>{
 const html=fixture({role:'stream',server:'http://127.0.0.1:48133',online:true}).render('devices');
 expect(html).toContain('Régie de cet ordinateur');
 expect(html).toContain('Créer un code d’association sur FIXE');
 expect(html).toContain('data-task="device-setup"');
 expect(html).not.toContain('Appareil connu');
});
it('OBS retains previously selected scenes and mic even if OBS disconnects',()=>{
 const html=fixture({role:'stream',obsOnline:false,scenes:[]}).render('obs');
 for(const name of ['INTRO','JEU','PAUSE','FIN','CHATTING','MICRO-OBS']) {
  expect(html).toContain(`value="${name}" selected`);
 }
 expect(html).toContain('name="obsUrl"');
 expect(html).toContain('name="obsPassword"');
 expect(html).toContain('name="remoteEnabled"');
 expect(html).toContain('OBS et scènes');
});
it('Existing Twitch, Google and advanced settings remain accessible and scoped',()=>{
 vi.stubGlobal('localStorage',{getItem:()=>null});
 const client=fixture().render('integrations');
 expect(client).toContain('Compte Google local facultatif sur ce PC client');
 expect(client).toContain('sans second secret OAuth');
 const profile=fixture().render('profile');
 expect(profile).toContain('Avancé · récompenses Twitch et tags JSON');
 expect(profile).toContain('name="streamerPingRewardIds"');
 expect(profile).toContain('name="tagPreferences"');
 expect(profile).toContain('id="profile-settings"');
 const paired=fixture({server:'https://FIXE.test:48136',online:true}).render('devices');
 expect(paired).toContain('Régie sélectionnée : FIXE');
 expect(paired).not.toContain('Non associée automatiquement');
});

it.skipIf(process.env.SC3_SETTINGS_BROWSER_TEST!=='1')('real Edge at 320px and desktop width shows responsive readable topology without side effects',async()=>{
 const html=fixture({preset:'dual-pc-deck'}).render('devices');
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const width of [320,390,1366]) {
   const page=await browser.newPage({viewport:{width,height:780},hasTouch:width<=390});
   const requests:string[]=[],errors:string[]=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
   await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main style="max-width:950px;margin:auto" id="root">'+html+'</main>');
   await page.addStyleTag({content:readFileSync('apps/mobile/control/control.css','utf8')});
   expect(await page.locator('[data-device-kind]').count()).toBe(3);
   expect(await page.locator('[data-device-kind="android"]').innerText()).toContain('Prévu dans le modèle');
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
   expect(requests).toEqual([]);expect(errors).toEqual([]);
   await page.close();
  }
 }finally{await browser.close();}
},35000);
