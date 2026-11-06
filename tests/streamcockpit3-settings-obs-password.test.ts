import {expect,it,vi} from 'vitest';
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
// @ts-expect-error Browser JavaScript module checked separately.
import {obsPasswordChange} from '../apps/mobile/control/obs-password-change.js';
// @ts-expect-error Browser JavaScript module checked separately.
import {renderSettings} from '../apps/mobile/control/settings-view.js';

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const input=(label:string,name:string,value:unknown='')=>`<label>${esc(label)}<input name="${esc(name)}" value="${esc(value)}"></label>`;
const select=(label:string,name:string,items:[string,string][],value:string)=>`<label>${esc(label)}<select name="${esc(name)}">${items.map(([id,text])=>`<option value="${esc(id)}" ${id===value?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
const check=(label:string,name:string,value:boolean)=>`<label>${esc(label)}<input type="checkbox" name="${esc(name)}" ${value?'checked':''}></label>`;
function view({role='stream',native=false,online=true,server='http://127.0.0.1:48133',saved=true}:{role?:'stream'|'control'|'mobile';native?:boolean;online?:boolean;server?:string;saved?:boolean}={}){
 const data={host:{hostname:'FIXE',settingsRevision:'fingerprint-revision',settings:{obsUrl:'ws://127.0.0.1:4555',obsPasswordSet:saved,modeScenes:{intro:'INTRO',live:'JEU',pause:'PAUSE',end:'FIN'},primaryMicInput:'MIC',chattingScene:'CHATTING',startMode:'intro',remoteEnabled:true},state:{obs:{inputs:{},scenes:[],connected:false},twitch:{connected:false},google:{connected:false}}},configuration:{revision:1,outputs:{twitch:{kind:'unconfigured',name:''}}}};
 const installation={preset:'single-pc',localDeviceId:'pc-1',devices:[{id:'pc-1',name:'FIXE',platform:'windows',roles:['obs-executor'],capabilities:['obs'],enabled:true}],routes:{obs:'pc-1'}};
 return renderSettings({data,installation,tab:'obs',device:{role,name:'FIXE'},native,server,online,localEndpoint:'http://127.0.0.1:48133',deviceExecutor:false,macroConfigurationError:'',knownPairedServer:'',esc,input,select,check});
}
it('a blank OBS password must never mean clear, even if a secret exists',()=>{
 const confirm=vi.fn();
 expect(obsPasswordChange({enteredPassword:'',clearRequested:false,canClear:true,confirmClear:confirm})).toEqual({});
 expect(confirm).not.toHaveBeenCalled();
});
it('a new password changes only the secret and requires no clear confirmation',()=>{
 const confirm=vi.fn();
 expect(obsPasswordChange({enteredPassword:'new-secret',canClear:false,confirmClear:confirm})).toEqual({obsPassword:'new-secret'});
 expect(confirm).not.toHaveBeenCalled();
});
it('clearing existing secret requires FIXE authorization and a second affirmative confirmation',()=>{
 const confirm=vi.fn().mockReturnValue(true);
 expect(()=>obsPasswordChange({clearRequested:true,canClear:false,confirmClear:confirm})).toThrow(/réservé/);
 expect(confirm).not.toHaveBeenCalled();
 expect(obsPasswordChange({clearRequested:true,canClear:true,confirmClear:confirm})).toEqual({clearObsPassword:true});
 expect(confirm).toHaveBeenCalledTimes(1);
});
it('a conflicting new password and clear request is refused before any confirmation',()=>{
 const confirm=vi.fn();
 expect(()=>obsPasswordChange({enteredPassword:'new-secret',clearRequested:true,canClear:true,confirmClear:confirm})).toThrow(/pas les deux/);
 expect(confirm).not.toHaveBeenCalled();
});
it('dismissed confirmation fails closed, without producing a mutation',()=>{
 expect(()=>obsPasswordChange({clearRequested:true,canClear:true,confirmClear:()=>false})).toThrow(/annulé/);
 expect(()=>obsPasswordChange({clearRequested:true,canClear:true})).toThrow(/annulé/);
});
it('the clearing checkbox appears only on online FIXE with an existing saved secret',()=>{
 const html=view();
 expect(html).toContain('name="obsPassword"');
 expect(html).toContain('name="clearObsPassword"');
 expect(html).toContain('confirmation obligatoire');
 expect(html).toContain('data-revision="fingerprint-revision"');
 for(const args of [{online:false},{saved:false},{role:'control' as const},{native:true},{server:'https://fixe.invalid:48136'}]){
  expect(view(args)).not.toContain('name="clearObsPassword"');
 }
});
it.skipIf(process.env.SC3_SETTINGS_PASSWORD_EDGE!=='1')('real Microsoft Edge renders the protected option at 320 and 1366px without side effects',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const width of [320,1366]){
   const page=await browser.newPage({viewport:{width,height:780}});
   const requests:string[]=[];
   await page.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
   await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main>'+view()+'</main>');
   await page.addStyleTag({content:readFileSync('apps/mobile/control/control.css','utf8')});
   const clear=page.locator('[name="clearObsPassword"]');
   expect(await clear.count()).toBe(1);
   expect(await clear.isChecked()).toBe(false);
   expect(await page.locator('form#settings-form').getAttribute('data-revision')).toBe('fingerprint-revision');
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
   expect(requests).toEqual([]);
   await page.close();
  }
 }finally{await browser.close();}
},30000);
