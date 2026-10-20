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
