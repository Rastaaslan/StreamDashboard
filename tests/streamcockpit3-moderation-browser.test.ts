import {it,expect} from 'vitest';
import {build} from 'esbuild';
import express from 'express';
import {chromium,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import type {AddressInfo} from 'node:net';
import {ModerationTwitch} from '../integrations/twitch/src/streamcockpit-moderation.js';
import {createTwitchModerationRouter} from '../apps/server/src/streamcockpit-twitch-moderation-router.js';
import {RemoteAuth} from '../apps/server/src/remote-auth.js';
import {twitchPollActor} from '../apps/server/src/streamcockpit-twitch-poll-router.js';
async function browserFixture(run:(f:{page:Page;puts:()=>number;lose:()=>void})=>Promise<void>){
  let active=false,count=0,lost=false;
  const auth=new RemoteAuth(),invite=auth.createPairing(undefined,true,['chat','cloud']),paired=auth.pair(invite.id,invite.code,'Browser fixture');
  const api=new ModerationTwitch(()=>({clientId:'fixture',accessToken:'PRIVATE',broadcasterId:'42'}),async(url,init)=>{
    if(String(url).includes('/validate'))return Response.json({client_id:'fixture',user_id:'42',scopes:['moderator:manage:shield_mode'],expires_in:300});
    if(init?.method==='PUT'){count++;active=JSON.parse(String(init.body)).is_active;if(lost)throw Error('PRIVATE')}
    return Response.json({data:[{is_active:active}]});
  });
  const bundle=await build({stdin:{contents:"import {mountTwitchModeration} from './apps/mobile/control/streamcockpit-twitch-moderation.js';window.mountModeration=mountTwitchModeration;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const app=express();app.use(express.json());app.use('/api/v1/twitch/advanced/moderation',createTwitchModerationRouter({api,actor:req=>twitchPollActor(req,auth,false,true),host:()=> 'FIXE'}));
  app.get('/',(_q,res)=>res.type('html').send('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main><script src="/bundle.js"></script>'));
  app.get('/bundle.js',(_q,res)=>res.type('js').send(bundle.outputFiles[0].text));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
    const origin='http://127.0.0.1:'+(server.address()as AddressInfo).port;
    await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    await page.goto(origin);await page.addStyleTag({content:readFileSync('apps/mobile/control/streamcockpit-mobile-v2.css','utf8')});
    await page.evaluate(({token})=>{
      const w=window as any;
      w.panel=w.mountModeration(document.getElementById('root'),{request:async(path:string,body:any,method:string)=>{
        const res=await fetch(path,{method,headers:{'Content-Type':'application/json',authorization:'Device '+token},body:JSON.stringify(body)});
        const value=await res.json();if(!res.ok)throw Object.assign(Error('HOST'),{status:res.status});return value;
      }});
      w.panel.update({online:true,sourceKey:'FIXE',accountKey:'owner'});
    },{token:paired.credential});
    await run({page,puts:()=>count,lose:()=>{lost=true}});
  }finally{await browser.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
const browserOnly=process.env.SC3_FINAL_BROWSER_TEST!=='1';
it.skipIf(browserOnly)('F02 actual Edge 320px + paired HTTP: consent, readback, no page overflow',async()=>browserFixture(async({page,puts})=>{
  const apply=page.getByRole('button',{name:'Appliquer sur Twitch'});
  expect(await apply.isVisible()).toBe(false);
  await page.getByRole('button',{name:'Vérifier sans modifier Twitch'}).click();
  await expect.poll(()=>apply.isVisible()).toBe(true);expect(await apply.isDisabled()).toBe(true);expect(puts()).toBe(0);
  await page.getByLabel('Confirmer la modification Twitch').check();await apply.click();
  await expect.poll(()=>page.getByRole('status').textContent()).toBe('Modification confirmée puis relue sur Twitch.');
  expect(puts()).toBe(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
}),30000);
it.skipIf(browserOnly)('F02 lost PUT + reconnect stays uncertain until an explicit external check, without resend',async()=>browserFixture(async({page,puts,lose})=>{
  await page.getByRole('button',{name:'Vérifier sans modifier Twitch'}).click();
  await page.getByLabel('Confirmer la modification Twitch').check();lose();
  await page.getByRole('button',{name:'Appliquer sur Twitch'}).click();
  await expect.poll(()=>page.getByRole('status').textContent()).toContain('Issue incertaine');
  await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'))});
  expect(await page.getByRole('button',{name:'Vérifier sans modifier Twitch'}).isDisabled()).toBe(true);expect(puts()).toBe(1);
  await page.getByRole('button',{name:'J’ai vérifié le réglage dans Twitch'}).click();
  await page.getByRole('button',{name:'Vérifier sans modifier Twitch'}).click();
  await page.getByLabel('Confirmer la modification Twitch').check();await page.getByRole('button',{name:'Appliquer sur Twitch'}).click();
  await expect.poll(()=>page.getByRole('status').textContent()).toContain('Aucune écriture envoyée');expect(puts()).toBe(1);
}),30000);
