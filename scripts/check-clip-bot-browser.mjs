import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir, networkInterfaces } from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { encode, decode } from '@msgpack/msgpack';
import { MemorySecretStore } from '../dist/apps/server/src/storage.js';
import { startDashboardServer } from '../dist/apps/server/src/index.js';

// Isolated browser -> paired LAN controller -> real host -> simulated OBS v5.
// No account tokens, real OBS process or public broadcast is used by this check.
const dataDir = await mkdtemp(path.join(tmpdir(), 'streamdashboard-browser-'));
const outputDir = path.resolve(process.env.CONTROL_SCREENSHOTS || 'test-results/control-next');
await mkdir(outputDir, { recursive: true });
let wizeText="Viens près du feu", wizeApply=true;
let fakeStreaming=false, replayActive=false, replayPath='', saves=0, posts=[], dropNext=false;
let timerUrl='http://127.0.0.1:48132/overlay/timer/', mediaCalls=[], muted = false, scene = 'Jeu', muteCalls = 0, sceneCalls = 0;
const obs = new WebSocketServer({ host: '127.0.0.1', port: 0 });
obs.on('connection', socket => {
  socket.send(encode({ op: 0, d: { obsWebSocketVersion: '5.6.3', rpcVersion: 1 } }));
  socket.on('message', data => {
    const message = decode(new Uint8Array(data));
    if (message.op === 1) { socket.send(encode({ op: 2, d: { negotiatedRpcVersion: 1 } })); return; }
    if (message.op !== 6) return;
    const { requestId, requestType, requestData = {} } = message.d;
    if(requestType==='SetInputSettings'&&requestData?.inputName==='Timer')timerUrl=requestData.inputSettings.url;
    if(requestType==='TriggerMediaInputAction')mediaCalls.push(requestData.mediaAction);
    if (requestType === 'SetInputMute') { muted = requestData.inputMuted; muteCalls++; }
    if (requestType === 'SetCurrentProgramScene') { scene = requestData.sceneName; sceneCalls++; socket.send(encode({op:5,d:{eventType:'CurrentProgramSceneChanged',eventIntent:4,eventData:{sceneName:scene}}})); }
    if(requestType==='StartReplayBuffer')replayActive=true;
    if(requestType==='StopReplayBuffer')replayActive=false;
    if(requestType==='SaveReplayBuffer'){replayPath='/clips/replay-'+(++saves)+'.mkv';socket.send(encode({op:5,d:{eventType:'ReplayBufferSaved',eventIntent:64,eventData:{savedReplayPath:replayPath}}}));}
    const responses = {
      GetReplayBufferStatus:{outputActive:replayActive},GetLastReplayBufferReplay:{savedReplayPath:replayPath},GetRecordDirectory:{recordDirectory:'/clips'},
      GetProfileParameter:{parameterValue:requestData?.parameterName==='Mode'?'Advanced':requestData?.parameterName==='RecRB'?'true':'20',defaultParameterValue:''},
      GetVersion: { obsVersion: '31', obsWebSocketVersion: '5' },
      GetOutputList: { outputs: [] },
      CallVendorRequest: { responseData: requestData?.requestType === 'version' ? { success:true, version:'1.2.4' } : { success:true, outputs:[{name:'YouTube horizontal',type:'stream',active:false}] } },
      GetCurrentProgramScene: { currentProgramSceneName: scene },
      GetSceneList: { scenes: ['Jeu','Pause','Introduction','Discussion'].map(sceneName => ({ sceneName })) },
      GetStreamStatus: { outputActive: fakeStreaming }, GetRecordStatus: { outputActive: false },
      GetInputList: { inputs: [{ inputName: 'Micro', inputKind: 'wasapi_input_capture' },{inputName:'StreamDashboard • Soundboard',inputKind:'ffmpeg_source'},{inputName:'Timer',inputKind:'browser_source'}] },
      GetInputMute: { inputMuted: requestData?.inputName==='Micro'?muted:false }, GetInputVolume: { inputVolumeMul: 1, inputVolumeDb: 0 },
      GetInputSettings:{inputSettings:{url:timerUrl}},
      GetInputAudioTracks:{inputAudioTracks:{'1':true}}, GetInputAudioMonitorType:{monitorType:'OBS_MONITORING_TYPE_NONE'},
      GetSpecialInputs: { mic1: 'Micro' },
      GetSceneItemList: { sceneItems: [{ sourceName: 'Micro', sceneItemEnabled: true },{sourceName:'StreamDashboard • Soundboard',sceneItemEnabled:true},{sourceName:'Timer',sceneItemEnabled:true}] },
    };
    socket.send(encode({ op: 7, d: { requestId, requestType, requestStatus: { result: true, code: 100 }, responseData: responses[requestType] || {} } }));
  });
});
await once(obs, 'listening');
process.env.OBS_URL = `ws://127.0.0.1:${obs.address().port}`;
const realFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const url=String(input);if(url.startsWith('https://fixture_channel.streaming.lv/')){if(url.includes('commands_list.php'))return Response.json({data:[['!discord','123',wizeText,'-','','SAY',0,'category']]});if(url.endsWith('ajax.php'))return new Response("ajax: 'ajax/list/commands_list.php?t="+'a'.repeat(64)+"'");return new Response('home',{headers:{'set-cookie':'PHPSESSID=anonymous; Path=/'}});}if(url.startsWith('https://id.twitch.tv/'))return new Response(JSON.stringify({client_id:'fixture',user_id:'42',login:'fixture_channel',scopes:['user:write:chat']}));if(url.startsWith('https://api.twitch.tv/')){if(url.includes('/chat/messages')){const body=JSON.parse(init.body);posts.push(body);if(wizeApply&&body.message.startsWith('!cmd edit 123 '))wizeText=body.message.slice('!cmd edit 123 '.length);const sent=!dropNext;dropNext=false;return new Response(JSON.stringify({data:[{is_sent:sent,message_id:sent?'message_'+posts.length:'',drop_reason:sent?undefined:{code:'automod_held',message:'held'}}]}));}return new Response(JSON.stringify({data:[]}));}return realFetch(input,init);};
await writeFile(path.join(dataDir,'dashboard.json'),JSON.stringify({schemaVersion:6,twitch:{broadcasterId:'42',userName:'fixture_channel',displayName:'Fixture'}}));
const secretStore=new MemorySecretStore();await secretStore.setTwitchTokens({accessToken:'fixture-only'});
const options = { secretStore,twitchClientId:'fixture', port: 0, host: '0.0.0.0', remoteEnabled: true, dataDir, logger: { info(){}, warn(){}, error(){} } };
let host, browser;
try {
  host = await startDashboardServer(options);
  const api = async (route, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(host.url + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
  };
  let state = await api('/api/v2/state');
  await api('/api/v2/settings', { expectedRevision: state.host.settingsRevision, primaryMicInput: 'Micro',timerBrowserSource:'Timer', modeScenes: { live: 'Jeu', pause: 'Pause', intro: 'Introduction' }, chattingScene: 'Discussion' }, 'PUT');
  assert.equal((await api('/api/v2/timer/overlay')).ready,false);
  assert.equal((await api('/api/v2/timer/overlay',{})).ready,true);assert.equal(timerUrl,host.url+'/overlay/timer/');
  timerUrl='https://example.test/other-overlay';const refused=await fetch(host.url+'/api/v2/timer/overlay',{method:'POST'});assert.equal(refused.status,400);assert.equal(timerUrl,'https://example.test/other-overlay');timerUrl=host.url+'/overlay/timer/';
  const pair = await api('/api/v1/remote/pairing', { management: true });
  const paired = await api('/api/v1/remote/pair', { id: pair.id, code: pair.code, name: 'Browser mobile verification' });
  const address = Object.values(networkInterfaces()).flat().find(v => v?.family === 'IPv4' && !v.internal)?.address;
  assert.ok(address, 'LAN interface required to verify paired remote authorization');
  const remote = `http://${address}:${host.port}`;
  browser = await chromium.launch({ headless: true });
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const phone = await browser.newPage({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const errors = [];
  for (const page of [desktop, phone]) { await page.addInitScript(() => { localStorage.setItem('sd2.monitor-enabled','false'); localStorage.setItem('sd2.page','deck'); }); await page.route('https://**', route => route.fulfill({status:200,contentType:'text/html',body:'<p>Isolated external player/chat fixture</p>'})); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', dialog => dialog.accept()); }
  await phone.addInitScript(value => localStorage.setItem('streamdashboard.device', value), paired.credential);
  await desktop.goto(host.url + '/mobile/control/');
  await phone.goto(remote + '/mobile/control/');
  await expect(desktop.locator('[data-action="micro"]')).toBeEnabled();
  await expect(phone.locator('[data-action="micro"]')).toBeEnabled();
  await desktop.keyboard.press('Control+Alt+Shift+F1');
  await expect.poll(() => muted).toBe(true);
  await expect(desktop.locator('.receipt').first()).toContainText('Réussi');
  assert.equal(muteCalls, 1);
  await phone.locator('[data-action="scene-pause"]').click();
  await expect.poll(() => scene).toBe('Pause');
  await expect(phone.locator('.receipt').first()).toContainText('Réussi');
  assert.equal(sceneCalls, 1);
  await phone.locator('nav [data-page="deck"]').click();
  await phone.locator('[data-action="clip-save"]').click();
  await expect(phone.locator('.receipt').first()).toContainText('Tampon arrêté');assert.equal(saves,0);
  await phone.locator('[data-action="replay.start"]').click();
  await expect(phone.locator('[data-action="clip-save"]')).toContainText('Dernières 20 s');
  await desktop.keyboard.press('Control+Alt+Shift+F5');
  await expect.poll(()=>saves).toBe(1);
  await expect(phone.locator('.receipt').first()).toContainText('/clips/replay-1.mkv');
  const receipt=(await api('/api/v2/state')).receipts.at(-1);assert.equal(receipt.result.replayPath,replayPath);
  await api('/api/v2/actions',{id:receipt.id,issuedAt:new Date().toISOString(),action:receipt.action});assert.equal(saves,1);
  await phone.locator('[data-action="replay.stop"]').click();await expect.poll(()=>replayActive).toBe(false);
  fakeStreaming=true;for(const socket of obs.clients)socket.send(encode({op:5,d:{eventType:'StreamStateChanged',eventIntent:64,eventData:{outputActive:true}}}));await expect.poll(()=>replayActive).toBe(true);
  await phone.locator('[data-action="replay.stop"]').click();await expect.poll(()=>replayActive).toBe(false);await phone.waitForTimeout(500);assert.equal(replayActive,false);
  fakeStreaming=false;for(const socket of obs.clients)socket.send(encode({op:5,d:{eventType:'StreamStateChanged',eventIntent:64,eventData:{outputActive:false}}}));
  await phone.locator('[data-deck-category="wizebot"]').click();
  await expect(phone.locator('[data-action="wizebot-uptime"]')).toBeEnabled();
  await phone.locator('[data-action="wizebot-uptime"]').click();
  await expect.poll(()=>posts.length).toBe(1);assert.equal(posts[0].message,'!uptime');assert.equal(posts[0].broadcaster_id,'42');
  await expect(phone.locator('.receipt').first()).toContainText('réponse de WizeBot reste à vérifier');
  dropNext=true;await phone.locator('[data-action="wizebot-game"]').click();await expect(phone.locator('.receipt').first()).toContainText('Échec');
  await phone.locator('[data-task="new-wizebot"]').click();await phone.locator('#wizebot-form [name="label"]').fill('Mon Discord');await phone.locator('#wizebot-form [name="value"]').fill('!discord');await phone.locator('#wizebot-form button:not([type])').click();
  await expect(phone.locator('button[data-action]').filter({hasText:'Mon Discord'})).toBeVisible();
  state=(await api('/api/v2/state'));const added=state.configuration.actions.find(a=>a.label==='Mon Discord');assert.equal(added.type,'wizebot.command');assert.equal(added.value,'!discord');
  await phone.locator('[data-page="actions"]').click();await phone.locator('[data-edit-action="'+added.id+'"]').click();await phone.locator('#wizebot-form [name="label"]').fill('Discord du camp');await phone.locator('#wizebot-form button:not([type])').click();
  await phone.locator('nav [data-page="deck"]').click();await phone.locator('[data-deck-category="wizebot"]').click();await expect(phone.locator('[data-action="'+added.id+'"]').filter({hasText:'Discord du camp'})).toBeVisible();
  await phone.locator('[data-task="wizebot-catalog"]').click();
  await expect(phone.locator('[data-wiz-edit="123"]')).toBeVisible();
  await phone.locator('#wizebot-import-form button:not([type])').click();
  await expect(phone.locator('.wiz-command')).toContainText('Déjà dans le Deck');
  state=await api('/api/v2/state');assert.equal(state.configuration.actions.filter(a=>a.wizebot?.id==='123').length,1);assert.equal(state.configuration.actions.find(a=>a.wizebot?.id==='123').label,'Discord du camp');
  await phone.locator('[data-wiz-edit="123"]').click();await phone.locator('#wizebot-response-form textarea').fill('Bienvenue au camp 🔥');await phone.locator('#wizebot-response-form button:not([type])').click();
  await expect(phone.locator('#wiz-edit-result')).toContainText('Confirmé',{timeout:15000});assert.equal(posts.at(-1).message,'!cmd edit 123 Bienvenue au camp 🔥');
  await phone.locator('[data-wiz-back]').click();await expect(phone.locator('.wiz-preview')).toContainText('Bienvenue au camp');
  await phone.screenshot({path:path.join(outputDir,'rc6-wizebot-mobile.png'),fullPage:true});
  await phone.locator('[data-task="close-dialog"]').click();
  await desktop.locator('nav [data-page="deck"]').click();await desktop.locator('[data-deck-category="wizebot"]').click();await desktop.locator('[data-task="wizebot-catalog"]').click();await expect(desktop.locator('.wiz-preview')).toContainText('Bienvenue au camp');
  wizeApply=false;await desktop.locator('[data-wiz-edit="123"]').click();await desktop.locator('#wizebot-response-form textarea').fill('Pas confirmé');await desktop.locator('#wizebot-response-form button:not([type])').click();await expect(desktop.locator('#wiz-edit-result')).toContainText('À vérifier',{timeout:15000});assert.equal(posts.at(-1).message,'!cmd edit 123 Pas confirmé');

  await browser.close();browser=undefined;await host.stop();host=await startDashboardServer(options);state=await api('/api/v2/state');assert.ok(state.configuration.actions.some(a=>a.id===added.id&&a.label==='Discord du camp'));assert.equal(state.receipts.find(r=>r.id===receipt.id).result.replayPath,'/clips/replay-1.mkv');
  const storedWize=await api('/api/v2/wizebot/catalog');assert.equal(storedWize.items[0].publishedText,'Bienvenue au camp 🔥');assert.equal(storedWize.edits.at(-1).status,'uncertain');
  const remoteReplay=await fetch('http://'+address+':'+host.port+'/api/v2/replay',{headers:{Authorization:'Device '+paired.credential}});assert.equal(remoteReplay.status,200);
  console.log(JSON.stringify({result:'PASS',journeys:['paired LAN mobile replay preparation','M5 confirmed clip path','replay deduplication','WizeBot delivery and rejected message','mobile custom command CRUD and restart persistence','public catalog import and no duplicates','remote response editing with exact readback','unconfirmed bot changes remain uncertain'],saves,chatPosts:posts.length,pageErrors:errors}));assert.deepEqual(errors,[]);
}finally{await browser?.close();await host?.stop();await new Promise(resolve=>obs.close(resolve));await rm(dataDir,{recursive:true,force:true});globalThis.fetch=realFetch;}
