import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const state = {
  stateRevision: 12,
  mode: 'live',
  timer: { running: false, remaining: 300, deadline: null },
  planning: [{ id: 'p1', title: 'FC 26 · FC Peace', startAtUtc: new Date(Date.now()+3600000).toISOString(), endAtUtc: new Date(Date.now()+7200000).toISOString(), category: 'live', description: '', desiredPublication: { twitch: true } }],
  obs: { connected: true, streaming: true, scene: 'Gameplay', inputs: { Mic: { muted: false, volumeDb: -8 }, Game: { muted: false, volumeDb: -14 }, Discord: { muted: false, volumeDb: -18 } }, activeAudioInputs: ['Mic','Game','Discord'] },
  settings: { streamerName: 'DamDam', modeScenes: { intro: 'Intro', live: 'Gameplay', pause: 'Pause', end: 'Fin' }, chattingScene: 'Chatting', confirmStop: true },
  twitch: { connected: true, channelTitle: 'Test Live', gameName: 'In Sound Mind' },
  controlHub: { live: { isLive: true, title: 'Test Live', category: 'In Sound Mind', durationSeconds: 42 }, audience: { viewerCount: 17, chatters: [{ id:'1', displayName:'Mimi' }] }, chat: { messages: [{ id:'m1', text:'gg', chatter:{ displayName:'Mimi' } }] }, integrations: { obs:{status:'CONNECTED'}, twitch:{status:'CONNECTED'}, streamlabs:{status:'NOT_CONFIGURED'} } }
};
const soundboard = { available: true, currentPlayback: null, sounds: [{ id:'bonk', name:'BONK', category:'Réactions', favorite:true, enabled:true, sourceAvailable:true, volume:1 }] };

test('preview figé pilote réellement scènes et soundboard via HTTP sans dépendre du websocket', async () => {
  const profile=await mkdtemp(path.join(os.tmpdir(),'streamdashboard-preview-live-'));
  let app:ElectronApplication|undefined;
  try{
    app=await electron.launch({args:[path.resolve('.')],env:{...process.env,NODE_ENV:'test',APPDATA:profile,XDG_CONFIG_HOME:profile}});
    const page=await app.firstWindow();
    const origin=await page.evaluate(()=>location.origin);
    const commands:any[]=[]; const sounds:any[]=[];
    await page.route('**/api/v1/state',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(state)}));
    await page.route('**/api/v1/soundboard',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(soundboard)}));
    await page.route('**/api/v1/remote/ws-ticket',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'ws intentionally unavailable'}})}));
    await page.route('**/api/v1/commands',async route=>{const body=route.request().postDataJSON();commands.push(body);route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,state:{...state,obs:{...state.obs,scene:body.mode==='pause'?'Pause':state.obs.scene}},commandType:body.type})});});
    await page.route('**/api/v1/soundboard/play',async route=>{sounds.push(route.request().postDataJSON());route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'succeeded',commandId:sounds.at(-1).commandId})});});
    let paired = false;
    await page.route('**/api/v1/remote/pair', async route => {
      paired = true;
      expect(route.request().postDataJSON()).toMatchObject({ id: 'pair-1', code: '123456' });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ credential: 'test-device-credential', deviceId: 'device-v2' }) });
    });
    await page.goto(`${origin}/mobile/preview.html?runtime=1`);
    await expect(page.locator('#home-title')).toHaveText('Aucun live en cours');
    await expect(page.locator('#home-viewers')).toHaveText('—');
    await expect(page.locator('#sounds-pc-copy')).toContainText('PC non appairé');
    await expect(page.locator('#preview-badge')).toHaveCount(0);
    await expect(page.locator('#sound-grid')).not.toContainText('BONK');

    await page.evaluate(link => window.dispatchEvent(new CustomEvent('native-pairing', { detail: link })), `streamdashboard://pair?v=1&server=${encodeURIComponent(origin)}&id=pair-1&code=123456`);
    await expect.poll(()=>paired).toBe(true);
    await expect(page.locator('#connection-dialog')).not.toBeVisible();

    await expect(page.locator('#home-title')).toHaveText('Test Live');
    await expect(page.locator('#home-viewers')).toHaveText('17');
    await expect(page.locator('#sounds-pc-copy')).toContainText('PC connecté');

    await page.locator('[data-quick-scene][data-scene="Pause"]').click();
    await expect.poll(()=>commands.length).toBe(1);
    expect(commands[0]).toMatchObject({type:'mode.set',mode:'pause'});

    await page.locator('#quick-sound-grid .quick-sound-button').first().click();
    await expect.poll(()=>sounds.length).toBe(1);
    expect(sounds[0]).toMatchObject({soundId:'bonk'});
  }finally{
    if(app)await app.close().catch(()=>undefined);
    await rm(profile,{recursive:true,force:true});
  }
});
