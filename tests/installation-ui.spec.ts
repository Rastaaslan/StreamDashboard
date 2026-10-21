import {test,expect} from '@playwright/test';
import express from 'express';
import path from 'node:path';
import type {Server} from 'node:http';
let server:Server,origin:string;
test.beforeAll(async()=>{
 const app=express();app.use('/mobile',express.static(path.resolve('apps/mobile')));
 app.get('/',(_req,res)=>res.send('<!doctype html><meta charset="utf-8"><div id="root"></div>'));
 server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
 origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
test.afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
for(const preset of ['single-pc','single-pc-deck','dual-pc','dual-pc-deck','android-only','custom']){
 test(preset+': same setup editor previews, commits and restores without deleting other data',async({page})=>{
  await page.goto(origin);
  await page.evaluate(async preset=>{
   const win=window as any,modelPath='/mobile/shared/installation.js',uiPath='/mobile/control/installation-ui.js';
   const model=await import(modelPath),ui=await import(uiPath);
   const android=preset==='android-only';
   let state=model.migrateInstallation({id:'local',platform:android?'android':'windows',legacy:{role:android?'mobile':'control',name:'Before'}}),backup:any;
   localStorage.setItem('preserved-planning','unchanged');
   const desktop=android?undefined:{getInstallation:async()=>structuredClone(state),changeInstallation:async(changes:any,revision:number)=>{const result=model.planInstallationChange(state,changes,revision);backup=state;state=result.next;return result;},restoreInstallation:async()=>{const next={...backup,revision:state.revision+1};backup=state;state=next;return {next,restart:false};}};
   win.ui=await ui.createInstallationUI({device:{name:'Before',role:android?'mobile':'control'},native:android,desktop,modal:(html:string)=>{document.querySelector('#root')!.innerHTML=html;},esc:(s:string)=>String(s),changed:(value:any)=>{win.saved=value;},select:async()=>{}});
   document.addEventListener('submit',event=>{event.preventDefault();void win.ui.submit(event.target);});
   document.addEventListener('click',event=>{const b=(event.target as Element).closest<HTMLButtonElement>('[data-task]');if(b)void win.ui.task(b.dataset.task,b);});
   win.ui.open();
  },preset);
  await expect(page.locator('[name=preset] option')).toHaveCount(6);
  await page.locator('[name=preset]').selectOption(preset);await page.locator('[name=name]').fill('After');
  await page.getByRole('button',{name:'Prévisualiser le changement'}).click();
  expect(await page.evaluate(()=>(window as any).saved)).toBeUndefined();
  await page.getByRole('button',{name:'Appliquer',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).saved?.preset)).toBe(preset);
  expect(await page.evaluate(()=>localStorage.getItem('preserved-planning'))).toBe('unchanged');
  await page.evaluate(()=>(window as any).ui.open());page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Restaurer la configuration précédente'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).saved?.revision)).toBe(2);
  expect(await page.evaluate(()=>(window as any).saved.devices[0].name)).toBe('Before');
 });
}
test('Android uses the same monitor with independent Twitch and YouTube targets without a PC',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('https://**/*',route=>route.abort());await page.goto(origin);
 await page.evaluate(async()=>{
  localStorage.setItem('sd2.monitor-enabled','true');
  const modulePath='/mobile/control/live-monitor.js';const {createLiveMonitor}=await import(modulePath);
  const monitor=createLiveMonitor(document.querySelector('#root'),{native:true});
  monitor.update({configuration:{youtube:{}},host:{}},{online:true,sourceKey:'device'});
 });
 await page.locator('.monitor-targets summary').click();
 await page.locator('[name=channel]').fill('test_channel');await page.locator('[name=video]').fill('Abc_1234-XY');
 await page.getByRole('button',{name:'Enregistrer ces retours'}).click();
 await expect(page.locator('iframe[title="Chat Twitch"]')).toHaveAttribute('src',/test_channel/);
 await expect(page.locator('iframe[title="Chat YouTube"]')).toHaveAttribute('src',/Abc_1234-XY/);
 await page.getByRole('button',{name:'YouTube',exact:true}).click();
 await expect(page.locator('[data-monitor-viewer-status]')).toContainText('non vérifiable');
 await expect(page.locator('[data-monitor-link="youtube"]')).toHaveAttribute('href',/Abc_1234-XY/);
});
