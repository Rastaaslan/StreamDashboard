import {expect,it} from 'vitest';
import {chromium} from '@playwright/test';
// @ts-expect-error Browser JS is checked separately with check:browser-types.
import {renderSettings} from '../apps/mobile/control/settings-view.js';

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function html(options:{server?:string;online?:boolean;pendingSyncCount?:number;pendingConflictCount?:number}={}){
 const {server='https://fixe.example:48136',online=true,pendingSyncCount=0,pendingConflictCount=0}=options;
 const data={host:{hostname:'FIXE',settingsRevision:'r1',settings:{obsPasswordSet:false},
  state:{at:new Date().toISOString(),obs:{scenes:[],inputs:{}},google:{connected:false},twitch:{connected:false},controlHub:{integrations:{}}}},
  configuration:{revision:1,outputs:{twitch:{kind:'unconfigured',name:''}}}};
 return renderSettings({data,native:false,server,online,tab:'integrations',device:{role:'control'},
  localEndpoint:'http://127.0.0.1:48135',deviceExecutor:false,installation:{devices:[]},macroConfigurationError:'',
  pendingSyncCount,pendingConflictCount,knownPairedServer:'',esc,input:()=>'',select:()=>'',check:()=>''});
}
it('clearly shows pending local edits and explains automatic sync versus read-only observation',()=>{
 const markup=html({pendingSyncCount:3,pendingConflictCount:1});
 expect(markup).toContain('data-settings-sync-status');
 expect(markup).toMatch(/3 modification\(s\).*en attente/);
 expect(markup).toMatch(/1 conflit\(s\).*résoudre/);
 expect(markup).toMatch(/synchronisation automatique.*envoyer/i);
 expect(markup).toMatch(/lecture seule/i);
});
it('does not claim remote confirmation when FIXE is offline or when no host is paired',()=>{
 const offline=html({online:false});
 expect(offline).toMatch(/Aucune modification locale en attente/);
 expect(offline).toMatch(/état distant.*pas confirmé/i);
 const local=html({server:'',online:false});
 expect(local).toMatch(/cet appareil uniquement/i);
 expect(local).not.toMatch(/synchronis(?:é|ée) avec FIXE/i);
});
it('does not print sync op keys, values, tokens or unsafe status markup',()=>{
 const markup=html({pendingSyncCount:2,pendingConflictCount:99});
 expect(markup).toMatch(/2 modification\(s\).*en attente/);
 expect(markup).toMatch(/2 conflit\(s\)/);
 expect(markup).not.toContain('99 conflit');
 expect(markup).not.toContain('data-task="sync-now"');
});
it.skipIf(process.env.SC3_SETTINGS_BROWSER_TEST!=='1')('real Edge displays pending status at 320px with no network or commands',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:740}});
  const requests:string[]=[];
  await page.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1">'+html({pendingSyncCount:4,online:false}));
  const message=await page.locator('[data-settings-sync-status]').innerText();
  expect(message).toContain('4 modification(s)');
  expect(message).toMatch(/lecture seule/);
  expect(requests).toEqual([]);
  await page.close();
 }finally{await browser.close();}
},25000);
