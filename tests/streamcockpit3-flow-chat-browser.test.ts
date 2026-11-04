import {afterAll,beforeAll,expect,it} from 'vitest';
import {build} from 'esbuild';
import {chromium,expect as pwExpect,type Browser,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';

const enabled=process.env.SC3_FINAL_BROWSER_TEST==='1';
let browser:Browser,bundle:string;
beforeAll(async()=>{
 if(!enabled)return;
 bundle=(await build({stdin:{contents:"import {createLiveMonitor} from './apps/mobile/control/live-monitor.js';import {createTwitchChat} from './apps/mobile/control/twitch-chat.js';window.mountMonitor=createLiveMonitor;window.mountChat=createTwitchChat;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',define:{'import.meta.url':JSON.stringify('http://127.0.0.1:38672/mobile/control/twitch-chat.js')}})).outputFiles[0].text;
 browser=await chromium.launch({channel:'msedge',headless:true});
});
afterAll(async()=>{await browser?.close()});
async function open(native=true):Promise<Page>{
 const page=await browser.newPage({viewport:{width:320,height:740},hasTouch:true});
 await page.route('**/*',route=>route.abort());
 await page.route('http://127.0.0.1:38672/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main>'}));
 await page.goto('http://127.0.0.1:38672/flow');
 await page.addStyleTag({content:readFileSync('apps/mobile/control/control.css','utf8')});
 await page.addStyleTag({content:readFileSync('apps/mobile/control/twitch-chat.css','utf8')});
 await page.addScriptTag({content:bundle});
 await page.evaluate(native=>{
  const w=window as any;
  w.calls=[];w.nativeCalls=[];w.confirm=()=>true;
  w.sample=(id:string,name:string)=>({identity:{broadcasterId:id,userName:name,displayName:name},accountConnected:true,capabilities:{chatRead:true,chatWrite:true},chat:{connected:true,messages:[{id:'m-'+id,broadcasterId:id,text:'Bonjour '+name,chatter:{id:'456',login:'viewer',displayName:'Viewer',badges:[]},receivedAt:new Date().toISOString()}]}});
  w.snapshot=w.sample('123','fixe_account');w.localSnapshot=w.sample('789','android_account');
  w.StreamDashboardProviders={
   twitchChatState:()=>{w.nativeCalls.push({method:'GET'});return JSON.stringify(w.localSnapshot)},
   twitchChatSend:(raw:string)=>{w.nativeCalls.push({method:'POST',body:JSON.parse(raw)});return JSON.stringify({ok:true,status:'sent',messageId:'local-confirmed'})}
  };
  w.request=async(path:string,body:any,method:string,source:string)=>{
   w.calls.push({path,body,method,source});
   if(path==='/api/v1/twitch/chat/state'){
    if(w.deferReads)return new Promise(resolve=>(w.pendingReads??=[]).push(resolve));
    return structuredClone(w.snapshot);
   }
   if(path==='/api/v1/twitch/moderation/capabilities')return {deleteMessage:true,timeout:true,ban:true,unban:true};
   if(path.startsWith('/api/v1/twitch/moderation/'))return {};
   if(path==='/api/v1/twitch/chat/messages')return w.receipt??{messageId:'host-confirmed'};
   throw Error('No synthetic provider for this path');
  };
  w.context={sourceKey:'FIXE',authorityKey:'FIXE',authorityOnline:true,online:true,chatOnly:true};
  w.data={host:{hostname:'FIXE',monitor:{twitchLogin:'fixe_account'}}};
  w.panel=native?w.mountMonitor(document.getElementById('root'),{native:true,request:w.request,controlRequest:w.request}):w.mountChat(document.getElementById('root'),{request:w.request});
  w.panel.update(...(native?[w.data,w.context]:[w.context]));
 },native);
 return page;
}
it.skipIf(!enabled)('paired Android defaults to authenticated FIXE chat without requiring Android OAuth or copying tokens',async()=>{
 const page=await open();
 try{
  await expect.poll(()=>page.locator('[data-twitch-identity]').textContent()).toContain('fixe_account');
  expect(await page.evaluate(()=>(window as any).nativeCalls.length)).toBe(0);
  await page.locator('[data-twitch-draft]').fill('Parcours relais simulé');
  await page.getByRole('button',{name:'Envoyer',exact:true}).click();
  await expect.poll(()=>page.locator('[data-twitch-result]').textContent()).toBe('Message envoyé par Twitch.');
  expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.path==='/api/v1/twitch/chat/messages'))).toEqual([{path:'/api/v1/twitch/chat/messages',body:{message:'Parcours relais simulé',expectedBroadcasterId:'123'},method:'POST',source:'FIXE'}]);
  expect(await page.evaluate(()=>(window as any).nativeCalls.length)).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
 }finally{await page.evaluate(()=>(window as any).panel.destroy());await page.close()}
},30000);
it.skipIf(!enabled)('Android local chat is explicit, source changes clear drafts and host disconnect never silently changes sender',async()=>{
 const page=await open();
 try{
  await expect.poll(()=>page.locator('[data-twitch-identity]').textContent()).toContain('fixe_account');
  await page.locator('[data-twitch-draft]').fill('Ne pas transférer ce brouillon');
  await page.evaluate(()=>{const w=window as any;w.context.online=false;w.context.authorityOnline=false;w.panel.update(w.data,w.context)});
  await pwExpect(page.locator('[data-twitch-send]')).toBeDisabled();
  expect(await page.evaluate(()=>(window as any).nativeCalls.length)).toBe(0);
  await page.getByLabel('Source du chat Twitch').selectOption('device');
  await expect.poll(()=>page.locator('[data-twitch-identity]').textContent()).toContain('android_account');
  await pwExpect(page.locator('[data-twitch-draft]')).toHaveValue('');
  await page.locator('[data-twitch-draft]').fill('Compte Android simulé');
  await page.getByRole('button',{name:'Envoyer',exact:true}).click();
  await expect.poll(()=>page.locator('[data-twitch-result]').textContent()).toBe('Message envoyé par Twitch.');
  expect(await page.evaluate(()=>(window as any).nativeCalls.filter((c:any)=>c.method==='POST').length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.path==='/api/v1/twitch/chat/messages').length)).toBe(0);
  await page.getByLabel('Source du chat Twitch').selectOption('host');
  await pwExpect(page.locator('[data-twitch-send]')).toBeDisabled();
  await pwExpect(page.locator('[data-twitch-identity]')).not.toContainText('android_account');
 }finally{await page.evaluate(()=>(window as any).panel.destroy());await page.close()}
},30000);
it.skipIf(!enabled)('chat resume fences reads from before suspension and requires a fresh account before enabling send',async()=>{
 const page=await open(false);
 try{
  await expect.poll(()=>page.locator('[data-twitch-identity]').textContent()).toContain('fixe_account');
  await page.locator('[data-twitch-draft]').fill('Brouillon avant veille');
  await page.evaluate(async()=>{const w=window as any;w.deferReads=true;void w.panel.refresh(true)});
  await expect.poll(()=>page.evaluate(()=>(window as any).pendingReads?.length)).toBe(1);
  await page.evaluate(()=>{
   Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));
  });
  await pwExpect(page.locator('[data-twitch-draft]')).toBeDisabled();
  await page.evaluate(()=>{
   Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(()=>page.evaluate(()=>(window as any).pendingReads?.length)).toBe(2);
  await page.evaluate(()=>{const w=window as any;w.pendingReads[0](w.sample('999','stale_account'))});
  await pwExpect(page.locator('[data-twitch-send]')).toBeDisabled();
  await pwExpect(page.locator('[data-twitch-identity]')).not.toContainText('stale_account');
  await page.evaluate(()=>{const w=window as any;w.pendingReads[1](w.snapshot)});
  await pwExpect(page.locator('[data-twitch-send]')).toBeEnabled();
  await pwExpect(page.locator('[data-twitch-draft]')).toHaveValue('Brouillon avant veille');
  expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.method==='POST').length)).toBe(0);
 }finally{await page.evaluate(()=>(window as any).panel.destroy());await page.close()}
},30000);
it.skipIf(!enabled)('uncertain or rejected chat receipts cannot claim sent even if a messageId is present',async()=>{
 const page=await open(false);
 try{
  await expect.poll(()=>page.locator('[data-twitch-identity]').textContent()).toContain('fixe_account');
  for(const receipt of [{status:'uncertain',messageId:'not-confirmed'},{ok:false,status:'failed',messageId:'not-confirmed'}]){
   await page.evaluate(value=>{(window as any).receipt=value},receipt);
   await page.locator('[data-twitch-draft]').fill('Conserver ce brouillon');
   await page.getByRole('button',{name:'Envoyer',exact:true}).click();
   await expect.poll(()=>page.locator('[data-twitch-result]').textContent()).toContain('Envoi non confirmé');
   await pwExpect(page.locator('[data-twitch-draft]')).toHaveValue('Conserver ce brouillon');
  }
  expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.method==='POST').length)).toBe(2);
 }finally{await page.evaluate(()=>(window as any).panel.destroy());await page.close()}
},30000);
it.skipIf(!enabled)('paired chat offers permission-checked moderation at 320px and refreshes permissions after an account change',async()=>{
 const page=await open(false);
 try{
  await expect.poll(()=>page.locator('[data-twitch-identity]').textContent()).toContain('fixe_account');
  const remove=page.locator('[data-moderate="deleteMessage"]');
  await pwExpect(remove).toBeVisible();
  await remove.click();
  expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.method==='DELETE').length)).toBe(1);
  await page.evaluate(async()=>{const w=window as any;w.snapshot=w.sample('234','other_account');await w.panel.refresh(true)});
  await expect.poll(()=>page.locator('[data-twitch-identity]').textContent()).toContain('other_account');
  expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.path==='/api/v1/twitch/moderation/capabilities').length)).toBe(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
 }finally{await page.evaluate(()=>(window as any).panel.destroy());await page.close()}
},30000);
