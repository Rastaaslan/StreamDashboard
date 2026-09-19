import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const state = {
  stateRevision: 12, mode: 'live', timer: { running: false, remaining: 300, deadline: null }, planning: [], checklist: [], templates: [], streamerPings: [],
  obs: { connected: true, streaming: true, scene: 'Gameplay', inputs: { Mic: { muted: false, volumeDb: -8 } }, activeAudioInputs: ['Mic'], mediaInputs: [], scenes: ['Gameplay','Pause'] },
  settings: { streamerName: 'Streamer', modeScenes: { intro: 'Intro', live: 'Gameplay', pause: 'Pause', end: 'Fin' }, chattingScene: 'Chatting', confirmStop: true, primaryMicInput: 'Mic' },
  twitch: { connected: true, channelTitle: 'Test Live', gameName: 'In Sound Mind' }, google: { connected: false }, discord: { configured: false },
  controlHub: { live: { isLive: true, title: 'Test Live', category: 'In Sound Mind', durationSeconds: 42 }, audience: { viewerCount: 17, chatters: [{ id:'1', displayName:'Mimi' }] }, chat: { connected: true, messages: [{ id:'m1', text:'gg', receivedAt:new Date().toISOString(), chatter:{ id:'1', displayName:'Mimi', badges:[] } }] }, integrations: { obs:{status:'CONNECTED'}, twitch:{status:'CONNECTED'}, streamlabs:{status:'NOT_CONFIGURED'} }, activity: [] }
};
const profile = { version:1, profile:{displayName:'Streamer',channelName:'',language:'fr'}, modules:{obs:true,twitch:true,planning:true,notes:true,checklist:true,templates:true,automations:true,soundboard:true,streamerPings:true,googleCalendar:false,discord:false,streamlabs:false,wizebot:false}, appearance:{theme:'dark',preset:'minimal',accent:'#2474e5',density:'normal',radius:'medium',textScale:'normal'}, mobile:{notifications:true,haptics:true}, providers:{twitch:{mode:'official'},google:{mode:'official'},discord:{mode:'official'},streamlabs:{mode:'custom'},wizebot:{mode:'custom'}}, onboarding:{completed:true}, obs:{scenes:[],quickActions:[]} };
const modules = Object.entries(profile.modules).map(([id,enabled])=>({id,label:id,enabled,availability:'available',dependencies:[],capabilities:[],blockedBy:[]}));
const connections = { items:[{id:'obs',label:'OBS',status:'connected',mode:'custom',requiresReauth:false,capabilities:['test','configure','scenes','audio']},{id:'twitch',label:'Twitch',status:'connected',mode:'official',requiresReauth:false,capabilities:['connect','disconnect','chat','audience','clips']}] };
const soundboard = { available:true,currentPlayback:null,sounds:[{id:'bonk',name:'BONK',category:'Réactions',favorite:true,enabled:true,sourceAvailable:true,volume:1}] };

test('les cinq parcours mobiles et leurs vues secondaires restent utilisables', async ({}, testInfo) => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'streamdashboard-mobile-shell-')); let app:ElectronApplication|undefined;
  try { app=await electron.launch({args:[path.resolve('.')],env:{...process.env,NODE_ENV:'test',APPDATA:directory,XDG_CONFIG_HOME:directory}}); const page=await app.firstWindow(); const origin=await page.evaluate(()=>location.origin); const commands:any[]=[];
    await page.route('**/api/v1/state',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(state)}));
    await page.route('**/api/v1/profile',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({profile,modules})}));
    await page.route('**/api/v1/connections',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(connections)}));
    await page.route('**/api/v1/soundboard',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(soundboard)}));
    await page.route('**/api/v1/remote/ws-ticket',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'ws unavailable'}})}));
    await page.route('**/api/v1/commands',async route=>{commands.push(route.request().postDataJSON());await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,state,commandType:commands.at(-1).type})});});
    await page.addInitScript(()=>localStorage.setItem('streamdashboard.device','test-device'));
    await page.goto(`${origin}/mobile/index.html`);
    await expect(page.locator('.bottom-nav [data-tab]:visible')).toHaveCount(5);
    for (const tab of ['home','live','sounds','planning','more']) {
      await page.locator(`[data-tab="${tab}"]`).click();
      await expect(page.locator(`[data-view="${tab}"]`)).toHaveClass(/active/);
      await page.screenshot({path:testInfo.outputPath(`${tab}-360.png`),fullPage:true});
    }
    await page.locator('[data-tab="live"]').click();
    await expect(page.locator('#hub-chat')).toContainText('gg'); await expect(page.locator('#live-viewers')).toHaveText('17');
    await page.getByRole('button',{name:/Timer/}).click(); await expect(page.locator('[data-live-panel="timer"]')).toBeVisible(); await page.getByRole('button',{name:'Fermer'}).click();
    await page.locator('#open-scenes-live').click(); await expect(page.locator('[data-live-panel="scenes"]')).toBeVisible(); await page.getByRole('button',{name:'Pause',exact:true}).click(); await expect.poll(()=>commands.length).toBeGreaterThan(0);
    await page.getByRole('button',{name:/Audio/}).click(); await expect(page.locator('#audio')).toContainText('Mic'); await page.getByRole('button',{name:'Fermer'}).click();
    await page.locator('[data-tab="sounds"]').click(); await expect(page.locator('#sound-grid')).toContainText('BONK');
    for (const variant of [{ width:320, theme:'oled', density:'compact', textScale:'large', accent:'#f5d90a' }, { width:360, theme:'light', density:'normal', textScale:'large', accent:'#123456' }, { width:360, theme:'dark', density:'comfort', textScale:'normal', accent:'#e6f7ff' }]) { profile.appearance={...profile.appearance,...variant}; await page.setViewportSize({width:variant.width,height:720}); await page.reload(); expect(await page.evaluate(()=>({document:document.documentElement.scrollWidth<=document.documentElement.clientWidth, body:document.body.scrollWidth<=document.body.clientWidth}))).toEqual({document:true,body:true}); }
        profile.modules.soundboard=false; await page.evaluate(()=>localStorage.setItem('streamdashboard.mobileTab','sounds')); await page.reload(); await expect(page.locator('[data-tab="sounds"]')).toBeHidden(); await expect(page.locator('[data-view="home"]')).toHaveClass(/active/);
  } finally { if(app)await app.close().catch(()=>undefined); await rm(directory,{recursive:true,force:true}); }
});
