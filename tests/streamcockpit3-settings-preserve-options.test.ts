import {expect,it} from 'vitest';
import {chromium} from '@playwright/test';
// @ts-expect-error Browser module is checked with check:browser-types.
import {renderSettings} from '../apps/mobile/control/settings-view.js';

const esc=(value:unknown)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const input=(label:string,name:string,value='')=>`<label>${esc(label)}<input name="${esc(name)}" value="${esc(value)}"></label>`;
const select=(label:string,name:string,items:[string,string][],value:string)=>`<label>${esc(label)}<select name="${esc(name)}">${items.map(([key,title])=>`<option value="${esc(key)}" ${key===value?'selected':''}>${esc(title)}</option>`).join('')}</select></label>`;
const check=(label:string,name:string,value:boolean)=>`<label><input name="${esc(name)}" type="checkbox" ${value?'checked':''}>${esc(label)}</label>`;

function markup(scenes:string[]=[],inputs:Record<string,unknown>={}){
 const data={host:{
   hostname:'FIXE',settingsRevision:'revision',state:{obs:{connected:scenes.length>0,inputs,scenes}},
   settings:{obsUrl:'ws://127.0.0.1:4555',primaryMicInput:'DJI Mic',
     modeScenes:{intro:'INTRO',live:'JEU',pause:'PAUSE',end:'FIN'},chattingScene:'CHATTING',
     remoteEnabled:true,startMode:'intro',obsPasswordSet:false}
  },configuration:{revision:5,outputs:{twitch:{kind:'main',name:''}}}};
 return renderSettings({data,native:false,server:'https://fixe.local',tab:'obs',online:true,
  device:{role:'control',name:'Laptop'},localEndpoint:'',deviceExecutor:false,macroConfigurationError:'',
  esc,input,select,check});
}

it('keeps existing OBS scenes and microphone selectable when OBS is disconnected',()=>{
 const html=markup();
 for(const [name,value] of Object.entries({'primaryMicInput':'DJI Mic','scene-intro':'INTRO','scene-live':'JEU','scene-pause':'PAUSE','scene-end':'FIN','chattingScene':'CHATTING'})){
   const field=html.match(new RegExp(`<select name="${name}">([\\s\\S]*?)<\\/select>`));
   expect(field?.[1],name).toContain(`<option value="${value}" selected>`);
   expect(field?.[1],name).toContain('conservé');
 }
});

it('preserves an absent selection without presenting it as an available OBS scene',()=>{
 const html=markup(['JEU','PAUSE'],{'Micro USB':{muted:false}});
 expect(html).toContain('<option value="JEU" selected>JEU</option>');
 expect(html).toContain('<option value="INTRO" selected>INTRO');
 expect(html).toContain('<option value="DJI Mic" selected>DJI Mic');
 expect(html).toContain('non détecté actuellement');
});

it('real Edge keeps the saved values after rendering and serializing a disconnected OBS form',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.setContent(markup(),{waitUntil:'domcontentloaded'});
  const values=await page.locator('#settings-form').evaluate(form=>Object.fromEntries(
   [...(form as HTMLFormElement).querySelectorAll('select')].map(select=>[select.name,select.value])));
  expect(values).toMatchObject({
   primaryMicInput:'DJI Mic','scene-intro':'INTRO','scene-live':'JEU',
   'scene-pause':'PAUSE','scene-end':'FIN',chattingScene:'CHATTING'
  });
 }finally{await browser.close();}
});
