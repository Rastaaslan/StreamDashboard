import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createYouTubeChatReader} from '../../apps/mobile/shared/youtube-chat.js';
const page=(text='hello')=>({items:[{id:'m1',snippet:{displayMessage:text,publishedAt:'2026-01-01'},authorDetails:{displayName:'Viewer'}}],nextPageToken:'next',pollingIntervalMillis:17000});
for(const setup of ['single-pc','single-pc-deck','dual-pc','dual-pc-deck','android-only','custom'])test(setup+': autonomous chat follows preparation, ingestion, live and end with its own polling clock',async()=>{
 let clock=0,state='created',chat='',ingestion='',calls=0;
 const reader=createYouTubeChatReader({now:()=>clock,broadcast:async id=>({id,channelId:'owner',account:'YouTube account',broadcastState:state,liveChatId:chat,ingestionStatus:ingestion}),messages:async()=>{calls++;return page();}});
 assert.equal((await reader.read('')).status,'no-selection');
 assert.equal((await reader.read('broadcast')).phase,'scheduled');
 clock=30000;state='ready';assert.equal((await reader.read('broadcast')).phase,'prepared');
 clock=60000;ingestion='active';assert.equal((await reader.read('broadcast')).phase,'ingesting');
 clock=90000;state='live';chat='correct-chat';const result=await reader.read('broadcast');
 assert.equal(result.status,'connected');assert.equal(result.phase,'live');assert.equal(result.nextPollAt,107000);assert.equal(result.messages.length,1);
 await Promise.all([reader.read('broadcast'),reader.read('broadcast')]);assert.equal(calls,1);
 clock=120000;state='complete';chat='';assert.equal((await reader.read('broadcast')).status,'ended');assert.equal((await reader.read('broadcast')).messages.length,1);assert.equal(calls,1);
});
test('one in-flight read, no cross-broadcast late responses and retained history after network loss',async()=>{
 let release,clock=0,requests=0,fail=false;
 const reader=createYouTubeChatReader({now:()=>clock,broadcast:async id=>({id,channelId:'owner',broadcastState:'live',liveChatId:'chat-'+id}),messages:async id=>{requests++;if(fail)throw Error('network');if(id==='chat-old')return new Promise(r=>{release=r;});return page('new only');}});
 const old=reader.read('old'),duplicate=reader.read('old');await new Promise(r=>setImmediate(r));assert.equal(requests,1);
 const next=await reader.read('new');assert.equal(next.messages[0].text,'new only');release(page('old message'));await Promise.all([old,duplicate]);
 assert.equal((await reader.read('new')).messages[0].text,'new only');
 clock=18000;fail=true;const offline=await reader.read('new');assert.equal(offline.status,'network');assert.equal(offline.messages[0].text,'new only');
 const count=requests;await reader.read('new');assert.equal(requests,count);
 clock=offline.nextPollAt;fail=false;assert.equal((await reader.read('new')).status,'connected');
});
for(const [reason,status] of [['quotaExceeded','quota'],['liveChatDisabled','disabled'],['liveChatEnded','ended'],['insufficientPermissions','authorization'],['liveChatNotFound','waiting']])test('explicit diagnostic '+reason,async()=>{
 const reader=createYouTubeChatReader({broadcast:async id=>({id,channelId:'owner',broadcastState:'live',liveChatId:'chat'}),messages:async()=>{throw {reason};}});
 const value=await reader.read('live');assert.equal(value.status,status);assert.ok(value.message);assert.ok(value.nextPollAt>Date.now());
});
