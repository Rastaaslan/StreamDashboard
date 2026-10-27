// Run from any directory: node --test tests/browser/desktop-live-reliability.mjs
// Real controller, IndexedDB and autonomy against a disposable loopback fixture.
// All non-fixture network requests are aborted; no provider or OBS runtime is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { chromium, expect } from '@playwright/test';
import { newWorkspace } from '../../apps/mobile/control/device-workspace.js';
import { merge, overlay, resources } from '../../apps/mobile/shared/autonomy.js';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const gate=()=>{let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};};
const waitOptions={timeout:10_000,intervals:[100,250,500]};
async function fixture(t,options={}){
  const initial=newWorkspace({name:'QA controller',role:'stream',configured:true});
  initial.workspace='browser-qa-'+crypto.randomUUID();
  const model={bundle:initial.bundle,items:[
    {id:'prepared-live',channelId:'qa-channel',title:'Live préparé <QA>',status:'ready',bound:true,scheduledStartTime:'2027-01-02T18:00:00Z'},
    {id:'unbound-live',channelId:'qa-channel',title:'Prochain live sans flux',status:'created',bound:false,scheduledStartTime:null},
  ],channels:[{id:'qa-channel',title:'Chaîne QA',customUrl:'@qa-channel'}],syncs:[],actions:[],requests:[],unexpectedWrites:[],catalogGate:null,actionGate:null};
  const data=model.bundle.data;
  data.configuration.youtube={clientId:'qa-client',broadcastId:'old-live',channelId:'qa-channel'};
  data.configuration.outputs={twitch:{kind:'main',name:''},youtube:{kind:'aitum-suite',name:'YouTube Output'}};
  data.configuration.metadata={title:'QA live',description:'Prepared locally',twitchGameId:'0',youtubeCategoryId:'20',tags:[]};
  data.host.standalone=false;
  data.host.local=true;
  data.host.hostname='QA fixture';
  data.host.settings={...data.host.settings,streamerName:'QA Stream',primaryMicInput:'Mic',modeScenes:{intro:'Intro',live:'Gameplay',pause:'Pause',end:'End'},chattingScene:'Chat'};
  data.host.state.obs={connected:true,streaming:true,streamingKnown:true,scene:'Gameplay',scenes:['Intro','Gameplay','Pause','Chat','End'],inputs:{Mic:{muted:false,volume:1}},activeAudioInputs:['Mic']};
  data.host.state.twitch={connected:true,userName:'qa_channel'};
  data.host.chat={connected:false,canSend:false,channel:''};
  data.host.monitor={twitchLogin:''};
  data.host.platforms={twitch:{live:true},youtube:{id:'old-live',channelId:'qa-channel',live:false,broadcastState:'ready',ingestionStatus:'active',bound:true}};
  data.host.outputStatus={twitch:{kind:'main',name:'',active:true},youtube:{kind:'aitum-suite',name:'YouTube Output',active:true}};
  model.bundle.sounds.available=true;
  model.replay={active:false,enabled:true,seconds:30,directory:'',error:''};
  if(options.empty)model.items=[];
  const touch=()=>{
    model.bundle.savedAt=Date.now();
    for(const value of Object.values(model.bundle.data.host.platforms))value.observedAt=new Date().toISOString();
    for(const value of Object.values(model.bundle.data.host.outputStatus))value.observedAt=new Date().toISOString();
  };
  const snapshot=()=>{touch();return {workspace:initial.workspace,bundle:structuredClone(model.bundle)};};
  const app=express();
  app.use(express.json());
  app.use((req,_res,next)=>{model.requests.push({method:req.method,path:req.path,query:{...req.query}});next();});
  app.get('/api/v2/autonomy',(_req,res)=>res.json(snapshot()));
  app.post('/api/v2/autonomy/sync',(req,res)=>{
    const edit=structuredClone(req.body.edit);
    model.syncs.push(edit);
    const result=merge(edit.base,edit.value,resources(model.bundle)[edit.key]??null);
    const status=result.conflicts.length?'conflict':'applied';
    if(status==='applied'){
      model.bundle=overlay(model.bundle,{[edit.key]:result.value});
      model.bundle.data.configuration.revision++;
    }
    res.json({...snapshot(),receipt:{id:edit.id,status,message:status==='applied'?'Applied by fixture':'Concurrent field change',fields:result.conflicts}});
  });
  app.get('/api/v1/soundboard',(_req,res)=>res.json(model.bundle.sounds));
  app.get('/api/v2/replay',(_req,res)=>res.json(model.replay));
  app.get('/api/v2/youtube/broadcasts',async(_req,res)=>{if(model.catalogGate)await model.catalogGate.promise;res.json({items:model.items});});
  app.get('/api/v2/youtube/channels',(_req,res)=>res.json({items:model.channels}));
  app.get('/api/v1/twitch/categories',(_req,res)=>res.json([{id:'27471',name:'Minecraft'},{id:'509658',name:'Just Chatting'}]));
  app.get('/api/v1/streamlabs/events',(_req,res)=>res.json({configured:false,connected:false,items:[]}));
  app.get('/api/v2/twitch/chat',(_req,res)=>res.json({identity:{broadcasterId:'qa',userName:'qa_channel',displayName:'QA'},accountConnected:true,chat:{connected:false,messages:[]},capabilities:{chatRead:false,chatWrite:false}}));
  app.post('/api/v2/actions',async(req,res)=>{
    model.actions.push(structuredClone(req.body));
    if(model.actionGate)await model.actionGate.promise;
    const receipt={id:req.body.id,action:req.body.action,status:'uncertain',message:'Fixture observation pending',createdAt:new Date().toISOString(),finishedAt:new Date().toISOString(),platforms:{youtube:{status:'uncertain',live:false,message:'Transition in progress',observedAt:new Date().toISOString()}}};
    model.bundle.data.receipts.push(receipt);
    res.json(receipt);
  });
  app.use('/api',(req,res)=>{
    if(req.method!=='GET')model.unexpectedWrites.push({method:req.method,path:req.originalUrl,body:req.body});
    res.status(404).json({error:{message:'Unmocked fixture endpoint '+req.method+' '+req.originalUrl}});
  });
  app.use('/mobile',express.static(path.join(repo,'apps/mobile')));
  const server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
  server.unref();
  const origin='http://127.0.0.1:'+server.address().port;
  const bundled=chromium.executablePath();
  const executablePath=process.env.SD_TEST_CHROMIUM||(existsSync(bundled)?bundled:existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
  const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(executablePath?{executablePath}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1100},locale:'fr-FR',timezoneId:'Europe/Paris',serviceWorkers:'block'});
  const page=await context.newPage();
  page.setDefaultTimeout(8_000);
  const pageErrors=[],dialogs=[],external=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('dialog',async dialog=>{dialogs.push({type:dialog.type(),message:dialog.message()});await dialog.dismiss();});
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin)return route.continue();
    external.push(url.origin);
    return route.abort('blockedbyclient');
  });
  await page.addInitScript(({origin})=>{
    localStorage.setItem('sd2.device',JSON.stringify({version:1,name:'QA browser',role:'stream',configured:true}));
    localStorage.setItem('sd2.server',origin);
    localStorage.setItem('sd2.workspace-mode','paired');
    localStorage.setItem('sd2.page','live');
  },{origin});
  t.after(async()=>{
    model.catalogGate?.release();model.actionGate?.release();
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    assert.deepEqual(pageErrors,[],'No uncaught controller exceptions');
    assert.deepEqual(dialogs,[],'No prompts, alerts or confirmations in these flows');
    assert.deepEqual(model.unexpectedWrites,[],'Only explicitly mocked effects are permitted');
  });
  await page.goto(origin+'/mobile/control/');
  await expect(page.locator('#connection')).toContainText('Régie connectée',waitOptions);
  await expect(page.locator('#live-controls')).toBeVisible();
  const settings=async()=>{
    await page.locator('nav [data-page="settings"]').click();
    try { await page.locator('[data-tab="platforms"]').click(); }
    catch(error){
      console.error('Settings navigation failed',await page.evaluate(()=>({notice:document.querySelector('#notice')?.textContent,page:localStorage.getItem('sd2.page'),content:document.querySelector('#content')?.innerHTML.slice(0,1800)})));
      await page.screenshot({path:'/tmp/desktop-live-reliability-navigation.png',fullPage:true});
      throw error;
    }
    await expect(page.locator('#platform-form')).toBeVisible();
  };
  const replicaValue=async key=>page.evaluate(async({scope,key})=>{
    const {openReplica}=await import('/mobile/control/autonomy-store.js');
    const {resources}=await import('/mobile/shared/autonomy.js');
    const store=await openReplica(scope);
    try{await store.reload();return resources(store.view())[key];}finally{store.close();}
  },{scope:origin,key});
  return {page,model,settings,touch,replicaValue,external};
}

test('Game search uses Enter without publishing, then retains the selected name and ID',async t=>{
  const {page,model}=await fixture(t);
  await page.locator('[data-task="metadata"]').click();
  await page.locator('#twitch-game-query').fill('Mine');
  await page.locator('#twitch-game-query').press('Enter');
  await expect(page.locator('#category-results [data-category="27471"]')).toHaveText('Minecraft');
  assert.equal(model.actions.length,0,'Enter in search must not submit metadata');
  assert.equal(model.syncs.length,0);
  assert.ok(model.requests.some(value=>value.path==='/api/v1/twitch/categories'&&value.query.query==='Mine'));
  await page.locator('#category-results [data-category="27471"]').click();
  await expect(page.locator('#metadata-form [name="twitchGameId"]')).toHaveValue('27471');
  await expect(page.locator('#twitch-game-query')).toHaveValue('Minecraft');
  await expect(page.locator('#twitch-game-selected')).toContainText('Minecraft');
  assert.equal(model.actions.length,0);
});

test('YouTube selection saves only its target and preserves an edited output plus its conflict baseline',async t=>{
  const {page,model,settings,touch,replicaValue}=await fixture(t);
  await settings();
  const output=page.locator('#platform-form [name="youtube-name"]');
  await output.fill('MY_OUTPUT_DRAFT');
  model.bundle.data.configuration.outputs.youtube.name='REMOTE_OUTPUT_CHANGE';
  model.bundle.data.configuration.revision++;
  touch();
  await expect.poll(async()=>(await replicaValue('output/youtube')).name,waitOptions).toBe('REMOTE_OUTPUT_CHANGE');
  await expect(output).toHaveValue('MY_OUTPUT_DRAFT');
  await page.locator('[data-task="youtube-broadcasts"]').click();
  await expect(page.locator('#youtube-picker .youtube-identity')).toContainText('Chaîne QA');
  await expect(page.locator('#youtube-picker .youtube-identity')).toContainText('@qa-channel');
  const prepared=page.locator('#youtube-picker .youtube-broadcast').filter({has:page.locator('[data-broadcast="prepared-live"]')});
  await expect(prepared).toContainText('Live préparé <QA>');
  await expect(prepared).toContainText('Prête');
  await expect(prepared).toContainText('2027');
  await expect(page.locator('#youtube-picker .youtube-broadcast').filter({has:page.locator('[data-broadcast="unbound-live"]')})).toContainText('Flux à associer dans YouTube Studio');
  await page.locator('[data-broadcast="prepared-live"]').click();
  await expect(page.locator('#dialog')).not.toBeVisible();
  await expect(page.locator('#platform-form [name="broadcastId"]')).toHaveValue('prepared-live');
  await expect(page.locator('#platform-form [name="channelId"]')).toHaveValue('qa-channel');
  await expect(output).toHaveValue('MY_OUTPUT_DRAFT');
  await expect.poll(()=>model.syncs.length,waitOptions).toBe(1);
  assert.equal(model.syncs[0].key,'youtube/root');
  assert.deepEqual(model.syncs[0].value,{clientId:'qa-client',broadcastId:'prepared-live',channelId:'qa-channel'});
  assert.equal(model.bundle.data.configuration.outputs.youtube.name,'REMOTE_OUTPUT_CHANGE');
  assert.equal(model.actions.length,0,'Choosing a target must not launch or publish a live');
  // A later explicit save should retain the original output base and detect the concurrent edit.
  await page.locator('#platform-form button[type="submit"], #platform-form .form-actions button').click();
  await expect.poll(()=>model.syncs.some(edit=>edit.key==='output/youtube'),waitOptions).toBe(true);
  const outputEdit=model.syncs.find(edit=>edit.key==='output/youtube');
  assert.equal(outputEdit.base.name,'YouTube Output');
  assert.equal(outputEdit.value.name,'MY_OUTPUT_DRAFT');
  assert.equal(model.bundle.data.configuration.outputs.youtube.name,'REMOTE_OUTPUT_CHANGE','The conflicted draft must not silently replace the remote output');
});

test('An empty YouTube catalogue explains the missing live and does not offer a fabricated target',async t=>{
  const {page,model,settings}=await fixture(t,{empty:true});
  await settings();
  await page.locator('[data-task="youtube-broadcasts"]').click();
  await expect(page.locator('#youtube-picker')).toContainText('Aucune diffusion à venir ou en cours trouvée');
  await expect(page.locator('#youtube-picker')).toContainText('Google Calendar ne crée pas à lui seul une diffusion YouTube');
  await expect(page.locator('#youtube-picker .youtube-identity')).toContainText('Chaîne QA');
  await expect(page.locator('#youtube-picker [data-broadcast]')).toHaveCount(0);
  assert.equal(model.syncs.length,0);
  assert.equal(model.actions.length,0);
});

test('Closing a pending YouTube lookup prevents late results from reopening the picker',async t=>{
  const {page,model,settings}=await fixture(t);
  model.catalogGate=gate();
  await settings();
  await page.locator('[data-task="youtube-broadcasts"]').click();
  await expect(page.locator('#youtube-picker')).toContainText('Recherche des diffusions');
  await page.locator('#dialog > [data-task="close-dialog"]').click();
  const arrived=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v2/youtube/broadcasts');
  model.catalogGate.release();
  await (await arrived).finished();
  // Wait for the response body and a DOM turn, rather than an arbitrary sleep.
  await expect(page.locator('#dialog')).not.toBeVisible();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(page.locator('#dialog')).not.toBeVisible();
  assert.equal(model.syncs.length,0);
  assert.equal(model.actions.length,0);
});

test('Active Twitch and received YouTube signal allow only targeted finalization, then liveStarting blocks another start',async t=>{
  const {page,model}=await fixture(t);
  await expect(page.locator('#live-controls > .grid [data-action="live.start"]:not([data-live-platform])')).toBeDisabled();
  await expect(page.locator('.live-destination').filter({has:page.locator('[data-live-platform="youtube"]')})).toContainText('YouTube reçoit le flux');
  const finish=page.locator('[data-action="live.start"][data-live-platform="youtube"]');
  await expect(finish).toHaveText('Finaliser YouTube');
  await expect(finish).toBeEnabled();
  model.actionGate=gate();
  await finish.click();
  await expect.poll(()=>model.actions.length,waitOptions).toBe(1);
  assert.equal(model.actions[0].action,'live.start');
  assert.equal(model.actions[0].platform,'youtube');
  assert.ok(model.actions[0].id);
  await expect(page.locator('[data-action="live.start"][data-live-platform="youtube"]')).toBeDisabled();
  model.bundle.data.host.platforms.youtube.broadcastState='liveStarting';
  model.actionGate.release();
  await expect(page.locator('#notice')).toContainText('Fixture observation pending');
  await expect(page.locator('[data-action="live.start"][data-live-platform="youtube"]')).toHaveCount(0);
  await expect(page.locator('.live-destinations')).toContainText('Démarrage en cours');
  await expect(page.locator('#live-controls > .grid [data-action="live.start"]:not([data-live-platform])')).toBeDisabled();
  assert.equal(model.actions.length,1);
  assert.equal(model.requests.filter(value=>value.method==='POST'&&value.path.startsWith('/api/v2/youtube/')).length,0);
});

test('A stopped replay buffer opens preparation without dispatching SaveReplayBuffer',async t=>{
  const {page,model}=await fixture(t);
  await page.locator('#live-controls [data-action="clip-save"]').click();
  await expect(page.locator('#replay-dialog-root')).toBeVisible();
  await expect(page.locator('#replay-dialog-root [data-action="replay.start"]')).toBeVisible();
  assert.equal(model.actions.length,0,'Clip requires preparation before any command is dispatched');
  assert.equal(model.requests.some(value=>value.method==='POST'&&value.path==='/api/v2/actions'),false);
});
