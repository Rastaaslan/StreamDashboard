import { expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
// Opt in on a host allowing Chromium; never bypass the workspace sandbox.
it.skipIf(process.env.PLANNING_BROWSER_TEST !== '1')('mounts Planning in Chromium, preserves an editor and makes zero requests', async()=>{
 const bundle=await build({stdin:{contents:`import {createPlanning} from './apps/mobile/control/planning.js';globalThis.createPlanning=createPlanning;`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
 const browser=await chromium.launch({headless:true});
 try {
 const page=await browser.newPage({viewport:{width:360,height:740}});const requests:string[]=[];
 await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
 await page.setContent('<main></main><form id="planning-event-form"><input name="title" value="Brouillon en cours"></form>');
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(()=>{
 const w=window as any;w.calls=[];
 const esc=(v:any)=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 w.planning=w.createPlanning({getData:()=>({host:{planning:[{id:'a',title:'<img src="https://invalid.example/x">',source:'GOOGLE',startAtUtc:new Date(Date.now()+3600000).toISOString(),endAtUtc:new Date(Date.now()+7200000).toISOString()}],settings:{}}}),getConnection:()=>w.online,esc,input:()=>'',select:()=>'',check:()=>'',api:()=>w.calls.push('api'),modal:()=>w.calls.push('modal')});
 });
 for(const online of [true,false,true])for(const view of ['next','week','events','manage']){
 await page.evaluate(({online,view})=>{const w=window as any;w.online=online;document.querySelector('main')!.innerHTML=w.planning.mobilePage(view);},{online,view});
 expect(await page.locator('[data-planning-assistant]').count()).toBe(1);
 expect(await page.locator('[data-planning-assistant]').textContent()).toContain('UNKNOWN');
 // Local-draft suggestions are available online; assisted duplication remains unavailable.
 // Check every suggestion across all views/offline transitions, never pick an arbitrary first button.
 const suggestions=page.locator('[data-planning-assistant] [data-planning="assist-new"]');
 expect(await suggestions.count()).toBe(3);
 for(let index=0;index<3;index++)expect(await suggestions.nth(index).isDisabled()).toBe(!online);
 expect(await page.getByRole('button',{name:'Dupliquer vers un brouillon (indisponible)',exact:true}).isDisabled()).toBe(true);
 expect(await page.locator('input[name=title]').inputValue()).toBe('Brouillon en cours');
 expect(await page.locator('img').count()).toBe(0);
 }
 expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);expect(requests).toEqual([]);
 }finally{await browser.close();}
},20000);
