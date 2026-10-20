import test from 'node:test';
import assert from 'node:assert/strict';
import {accountDiagnostic,nativeGoogleAccounts,createDeviceAccounts} from '../../apps/mobile/control/device-accounts.js';

test('failed YouTube authorization preserves Calendar status and shows the error on YouTube',()=>{
  const states=nativeGoogleAccounts({connected:true,calendarAuthorized:true,youtubeAuthorized:false,configured:true,authorizationError:true,authorizationProvider:'youtube',code:'GOOGLE_API_10'});
  assert.equal(states.google.connected,true);assert.equal(states.google.code,undefined);
  assert.equal(states.youtube.connected,false);assert.equal(states.youtube.code,'GOOGLE_API_10');
  assert.match(accountDiagnostic(states.youtube.code),/certificat/);
  assert.match(accountDiagnostic('GOOGLE_API_99999'),/code/);
});

test('Google Play errors and pending consent reach both Google cards',()=>{
  const states=nativeGoogleAccounts({configured:false,code:'GOOGLE_PLAY_SERVICES'});
  assert.equal(states.youtube.code,'GOOGLE_PLAY_SERVICES');
  const pending=nativeGoogleAccounts({configured:true,authorizing:true});
  assert.equal(pending.google.authorizing,true);assert.equal(pending.youtube.authorizing,true);
});

test('native failure is displayed after authorization acknowledgement without a fake browser prompt',async()=>{
  const original=globalThis.addEventListener;
  globalThis.addEventListener=()=>{};
  try{
    let html='',status={ok:true,connected:false,configured:true};
    const bridge={
      twitchStatus:()=>JSON.stringify({ok:true,connected:false}),
      googleStatus:()=>JSON.stringify(status),
      youtubeAuthorize:()=>{status={...status,authorizationError:true,authorizationProvider:'youtube',code:'GOOGLE_API_10'};return '{"ok":true,"nativeAuthorization":true}';}
    };
    const accounts=createDeviceAccounts({bridge,modal:value=>{html=value;},esc:String,toast:()=>{}});
    await accounts.open();
    await accounts.click({dataset:{accountConnect:'youtube'},hasAttribute:()=>false});
    assert.match(html,/GOOGLE_API_10/);assert.match(html,/certificat/);
    assert.doesNotMatch(html,/Terminez la connexion dans le navigateur/);
  }finally{if(original)globalThis.addEventListener=original;else delete globalThis.addEventListener;}
});

test('independent native accounts display both addresses and only disconnect the chosen service',async()=>{
  const original=globalThis.addEventListener;
  globalThis.addEventListener=()=>{};
  try{
    let html='',googleConnected=true,youtubeConnected=true;
    const calls=[];
    const bridge={
      twitchStatus:()=>JSON.stringify({ok:true,connected:false}),
      googleStatus:()=>JSON.stringify({ok:true,connected:googleConnected,configured:true,account:'agenda@example.test'}),
      youtubeStatus:()=>JSON.stringify({ok:true,connected:youtubeConnected,configured:true,account:'video@example.test',channelName:'Ma chaîne'}),
      youtubeLogout:()=>{calls.push('youtube');youtubeConnected=false;return '{"ok":true}';},
      googleLogout:()=>{calls.push('google');googleConnected=false;return '{"ok":true}';}
    };
    const accounts=createDeviceAccounts({bridge,modal:value=>{html=value;},esc:String,toast:()=>{}});
    await accounts.open();
    assert.match(html,/agenda@example.test/);assert.match(html,/video@example.test/);assert.match(html,/Ma chaîne/);
    assert.match(html,/Changer de compte/);
    await accounts.click({dataset:{accountLogout:'youtube'},hasAttribute:()=>false});
    assert.deepEqual(calls,['youtube']);assert.equal(googleConnected,true);assert.equal(youtubeConnected,false);
    assert.match(html,/Connecté · agenda@example.test/);
    await accounts.click({dataset:{accountLogout:'google'},hasAttribute:()=>false});
    assert.deepEqual(calls,['youtube','google']);
  }finally{if(original)globalThis.addEventListener=original;else delete globalThis.addEventListener;}
});

test('YouTube errors stay on YouTube while shared UI prevents overlapping account pickers',async()=>{
  const original=globalThis.addEventListener;globalThis.addEventListener=()=>{};
  try{
    let html='';
    const bridge={
      twitchStatus:()=>JSON.stringify({ok:true,connected:false}),
      googleStatus:()=>JSON.stringify({ok:true,connected:true,account:'agenda@example.test'}),
      youtubeStatus:()=>JSON.stringify({ok:true,connected:false,code:'GOOGLE_API_8',authorizing:true})
    };
    await createDeviceAccounts({bridge,modal:value=>{html=value;},esc:String,toast:()=>{}}).open();
    const google=html.split('<h3>Google Calendar</h3>')[1].split('</section>')[0];
    const youtube=html.split('<h3>YouTube</h3>')[1].split('</section>')[0];
    assert.doesNotMatch(google,/GOOGLE_API_8/);assert.match(youtube,/GOOGLE_API_8/);
    assert.match(google,/data-account-connect="google" disabled/);assert.match(youtube,/data-account-connect="youtube" disabled/);
  }finally{if(original)globalThis.addEventListener=original;else delete globalThis.addEventListener;}
});
