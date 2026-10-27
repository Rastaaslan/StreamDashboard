import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountDiagnostic,nativeGoogleAccounts,createDeviceAccounts} from '../../apps/mobile/control/device-accounts.js';

// Twitch + Google Calendar are the ONLY supported accounts. Legacy YouTube
// account UI regression is archived under docs/legacy-tests.
const status=(connected=false,other={})=>JSON.stringify({ok:true,connected,calendarAuthorized:connected,configured:true,...other});
async function withWindow(fn){
 const previous=globalThis.addEventListener;
 globalThis.addEventListener=()=>{};
 try{return await fn()}
 finally{if(previous)globalThis.addEventListener=previous;else delete globalThis.addEventListener}
}
const button=(type,provider)=>({dataset:{[type]:provider},hasAttribute:()=>false});

test('Google Calendar state reports only its own authorization and diagnostic',()=>{
 const connected=nativeGoogleAccounts({connected:true,calendarAuthorized:true,configured:true});
 assert.equal(connected.google.connected,true);
 const denied=nativeGoogleAccounts({connected:false,calendarAuthorized:false,
   authorizationError:true,authorizationProvider:'google',code:'GOOGLE_API_10'});
 assert.equal(denied.google.connected,false);
 assert.equal(denied.google.code,'GOOGLE_API_10');
 assert.match(accountDiagnostic(denied.google.code),/certificat/);
 assert.match(accountDiagnostic('GOOGLE_API_99999'),/code/);
});
test('account modal presents Twitch and Calendar, never retired YouTube even if old native methods exist',()=>withWindow(async()=>{
 let html='';
 const bridge={
  twitchStatus:()=>JSON.stringify({ok:true,connected:true,account:'streamer'}),
  googleStatus:()=>status(true,{account:'agenda@example.test'}),
  youtubeStatus:()=>JSON.stringify({ok:true,connected:true,account:'retired@example.test'}),
 };
 const accounts=createDeviceAccounts({bridge,modal:v=>{html=v},esc:String,toast:()=>{}});
 await accounts.open();
 assert.match(html,/Twitch/);
 assert.match(html,/Google Calendar/);
 assert.match(html,/agenda@example.test/);
 assert.doesNotMatch(html,/retired@example.test|data-account-connect="youtube"/);
}));
test('native calendar refusal is shown after acknowledgement, not as fictitious browser success',()=>withWindow(async()=>{
 let html='',state={connected:false,calendarAuthorized:false,configured:true};
 const bridge={
  twitchStatus:()=>JSON.stringify({ok:true,connected:false}),
  googleStatus:()=>JSON.stringify({ok:true,...state}),
  googleAuthorize:()=>{state={...state,authorizationError:true,authorizationProvider:'google',code:'GOOGLE_API_10'};return JSON.stringify({ok:true,nativeAuthorization:true})},
 };
 const accounts=createDeviceAccounts({bridge,modal:v=>{html=v},esc:String,toast:()=>{}});
 await accounts.open();
 await accounts.click(button('accountConnect','google'));
 assert.match(html,/GOOGLE_API_10/);
 assert.match(html,/certificat/);
 assert.doesNotMatch(html,/Terminez la connexion dans le navigateur/);
}));
test('Calendar logout does not touch Twitch session',()=>withWindow(async()=>{
 let html='',calendar=true,twitch=true;const calls=[];
 const bridge={
  twitchStatus:()=>JSON.stringify({ok:true,connected:twitch,account:'streamer'}),
  googleStatus:()=>status(calendar,{account:'agenda@example.test'}),
  googleLogout:()=>{calls.push('google');calendar=false;return JSON.stringify({ok:true})},
 };
 const accounts=createDeviceAccounts({bridge,modal:v=>{html=v},esc:String,toast:()=>{}});
 await accounts.open();
 await accounts.click(button('accountLogout','google'));
 assert.deepEqual(calls,['google']);
 assert.equal(twitch,true);
 assert.equal(calendar,false);
 assert.match(html,/Non connecté/);
 assert.doesNotMatch(html,/data-account-connect="youtube"/);
}));
test('pending Calendar authorization disables only Calendar, not Twitch',()=>withWindow(async()=>{
 let html='';
 const bridge={
  twitchStatus:()=>JSON.stringify({ok:true,connected:false}),
  googleStatus:()=>status(false,{authorizing:true,authorizationError:true,authorizationProvider:'google',code:'GOOGLE_API_10'}),
 };
 const accounts=createDeviceAccounts({bridge,modal:v=>{html=v},esc:String,toast:()=>{}});
 await accounts.open();
 assert.match(html,/data-account-connect="google" disabled/);
 assert.match(html,/data-account-connect="twitch"/);
 assert.doesNotMatch(html,/data-account-connect="twitch" disabled/);
 assert.match(html,/GOOGLE_API_10/);
}));
