import {it,expect} from 'vitest';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

it.skipIf(process.env.SC3_FINAL_BROWSER_TEST!=='1')(
 'F04 real Edge: editing description invalidates a pending host preview response before consent',async()=>{
 const bundle=await build({stdin:{
  contents:"import {mountTwitchMoments} from './apps/mobile/control/streamcockpit-twitch-moments.js';window.mountMoments=mountTwitchMoments;",
  resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
  const network:string[]=[];
  await page.route('**/*',route=>{network.push(route.request().url());return route.abort()});
  await page.route('http://127.0.0.1:38749/**',route=>route.fulfill({
   status:200,contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main>'}));
  await page.goto('http://127.0.0.1:38749/moments');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(()=>{
   const w=window as any;w.calls=[];w.resolvePreview=null;
   w.panel=w.mountMoments(document.getElementById('root'),{request:(path:string,body:any,method:string)=>{
    w.calls.push({path,body,method});
    if(path.endsWith('/preview')){
     return new Promise(resolve=>{w.resolvePreview=()=>{
      resolve({schemaVersion:1,kind:'streamcockpit-moment-preview',
       confirmationId:'643e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5',
       expiresAt:Date.now()+30000,draft:body.draft});
     }});
    }
    throw Error('PUBLIC_TWITCH_CONFIRM_MUST_NOT_BE_SENT');
   }});
   w.panel.update({online:true,sourceKey:'FIXE',accountKey:'owner'});
  });
  const description=page.getByLabel('Description du moment');
  await description.fill('Ancien texte');
  await page.getByRole('button',{name:'Vérifier le moment sans publier'}).click();
  await expect.poll(()=>page.evaluate(()=>typeof (window as any).resolvePreview)).toBe('function');
  // A queued input/IME event can arrive after the field was disabled for the in-flight preview.
  // Dispatch it directly because Playwright.fill correctly refuses to type into disabled inputs.
  await page.evaluate(()=>{const field=document.querySelector('input[aria-label="Description du moment"]') as HTMLInputElement;field.value='Nouveau texte';field.dispatchEvent(new Event('input',{bubbles:true}))});
  await page.evaluate(()=>(window as any).resolvePreview());
  await expect.poll(()=>page.getByRole('button',{name:'Vérifier le moment sans publier'}).isEnabled()).toBe(true);
  const publish=page.getByRole('button',{name:'Créer ce moment sur Twitch'});
  expect(await publish.isVisible()).toBe(false);
  expect(await page.getByRole('status').textContent()).toContain('nouvelle vérification');
  expect(await page.evaluate(()=>(window as any).calls.map((c:any)=>c.path))).toEqual(['/api/v1/twitch/advanced/moment/preview']);
  expect(await page.evaluate(()=>localStorage.getItem('sd3.f04.twitch-moment-uncertain.v1'))).toBeNull();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(network).toEqual([]);
 }finally{await browser.close()}
},30000);
