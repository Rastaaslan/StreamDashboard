import {expect,it} from 'vitest';
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
// @ts-expect-error Browser JavaScript module checked by the dedicated browser type project.
import {renderDevicesSettings} from '../apps/mobile/control/settings-simplified.js';

const esc = (value:unknown) => String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[char]!));

function devices({native,role,executor=false}:{native:boolean;role:string;executor?:boolean}) {
 return renderDevicesSettings({
   native,device:{role,name:native?'Android Deck':'FIXE'},
   installation:{preset:'dual-pc-deck',localDeviceId:'local',devices:[
     {id:'local',name:native?'Android Deck':'FIXE',platform:native?'android':'windows',enabled:true,roles:['obs-executor','controller']}
   ]},
   data:{host:{hostname:'FIXE',local:true}},
   server:native?'https://fixe.invalid:48136':'http://127.0.0.1:48133',
   online:!native,localEndpoint:'http://127.0.0.1:48133',
   deviceExecutor:executor?{}:null,macroConfigurationError:'',
   knownPairedServer:'',esc
 });
}

it('a native Android with stale stream role cannot present itself as FIXE or own pairing controls',()=>{
 const html=devices({native:true,role:'stream'});
 expect(html).not.toContain('Régie de cet ordinateur');
 expect(html).not.toContain('data-tab="obs"');
 expect(html).not.toContain('data-task="paired-devices"');
 expect(html).not.toContain('data-task="pairing"');
 expect(html).toContain('data-task="connection"');
 expect(html).toContain('Pas de connexion à une régie confirmée');
});

it('a native device executor still has local agent tools, never the FIXE OBS master authority',()=>{
 const html=devices({native:true,role:'stream',executor:true});
 expect(html).not.toContain('Régie de cet ordinateur');
 expect(html).not.toContain('data-tab="obs"');
 expect(html).toContain('data-task="local-permissions"');
 expect(html).toContain('data-task="transport"');
 expect(html).not.toContain('data-task="paired-devices"');
});

it('a real Windows FIXE stream profile retains unique master controls',()=>{
 const html=devices({native:false,role:'stream'});
 expect(html).toContain('Régie de cet ordinateur');
 expect(html).toContain('data-tab="obs"');
 expect(html).toContain('data-task="paired-devices"');
 expect(html).toContain('data-task="pairing"');
});

it.skipIf(process.env.SC3_ANDROID_OWNER_BROWSER!=='1')('real Edge 320px prevents stale Android master controls with no network effects',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:320,height:780},hasTouch:true});
  const requests:string[]=[];const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main>'+devices({native:true,role:'stream'})+'</main>');
  await page.addStyleTag({content:readFileSync('apps/mobile/control/control.css','utf8')});
  expect(await page.locator('[data-device-kind="master"]').innerText()).not.toContain('Régie de cet ordinateur');
  expect(await page.locator('[data-task="paired-devices"]').count()).toBe(0);
  expect(await page.locator('[data-task="connection"]').count()).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(requests).toEqual([]);expect(errors).toEqual([]);
 } finally {await browser.close();}
},30000);
