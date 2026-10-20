import assert from 'node:assert/strict';
import { test } from 'node:test';
import { liveControlState } from '../../apps/mobile/control/live-controls.js';

const now=Date.parse('2026-10-20T15:30:00Z'),observedAt=new Date(now).toISOString();
function fixture(){return {configuration:{outputs:{twitch:{kind:'main',name:''},youtube:{kind:'aitum-suite',name:'YouTube Output'}},youtube:{broadcastId:'selected',channelId:'channel'}},host:{state:{obs:{connected:true,streamingKnown:true,streaming:false}},platforms:{twitch:{live:false,observedAt},youtube:{live:false,observedAt}},outputStatus:{youtube:{kind:'aitum-suite',name:'YouTube Output',active:false,observedAt}}},receipts:[]};}

test('permits a combined start only when both platform and output states are confirmed stopped',()=>{
 const data=fixture();assert.equal(liveControlState(data,true,now).canStartBoth,true);
 delete data.host.outputStatus.youtube;
 assert.equal(liveControlState(data,true,now).canStartBoth,false);
});
test('blocks another combined start while either platform or named OBS output is active',()=>{
 const data=fixture();data.host.platforms.twitch.live=true;
 assert.equal(liveControlState(data,true,now).canStartBoth,false);
 data.host.platforms.twitch.live=false;data.host.outputStatus.youtube.active=true;
 const state=liveControlState(data,true,now);
 assert.equal(state.anyActive,true);assert.equal(state.mainActive,false);assert.equal(state.canStartBoth,false);
 assert.equal(state.destinations.youtube.canStart,true);
});
test('keeps a partial live visible and leaves only its unfinished destination available',()=>{
 const data=fixture();data.host.state.obs.streaming=true;data.host.platforms.twitch.live=true;
 const state=liveControlState(data,true,now);
 assert.equal(state.heading,'Diffusion en cours');assert.equal(state.destinations.twitch.canStart,false);assert.equal(state.destinations.youtube.canStart,true);
});
test('never treats stale or disconnected observations as a confirmed stopped live',()=>{
 const data=fixture();data.host.platforms.youtube.observedAt=new Date(now-60_000).toISOString();
 assert.equal(liveControlState(data,true,now).destinations.youtube.live,null);
 assert.equal(liveControlState(data,true,now).canStartBoth,false);
 assert.equal(liveControlState(fixture(),false,now).destinations.twitch.live,null);
 assert.equal(liveControlState(fixture(),false,now).canStartBoth,false);
});
test('blocks launch during another live command or before the YouTube target is selected',()=>{
 const data=fixture();data.receipts.push({action:'live.start',status:'running'});
 assert.equal(liveControlState(data,true,now).canStartBoth,false);
 data.receipts=[];data.configuration.youtube.broadcastId='';
 assert.equal(liveControlState(data,true,now).destinations.youtube.canStart,false);
});
test('does not reuse an observation for a different output with a previous name',()=>{
 const data=fixture();data.host.outputStatus.youtube.name='Old Output';
 assert.equal(liveControlState(data,true,now).destinations.youtube.active,null);
 assert.equal(liveControlState(data,true,now).canStartBoth,false);
});
test('keeps YouTube ingestion separate from its public live state',()=>{
 const data=fixture();Object.assign(data.host.platforms.youtube,{ingestionStatus:'active',broadcastState:'ready'});
 const state=liveControlState(data,true,now).destinations.youtube;
 assert.equal(state.live,false);assert.equal(state.ingestionStatus,'active');assert.equal(state.broadcastState,'ready');
});
test('does not offer another finalization while YouTube is already transitioning',()=>{
 for(const broadcastState of ['liveStarting','testStarting']){
  const data=fixture();Object.assign(data.host.platforms.youtube,{ingestionStatus:'active',broadcastState});
  const state=liveControlState(data,true,now);assert.equal(state.destinations.youtube.canStart,false);assert.equal(state.running,true);
 }
});

test('blocks a terminated or unbound YouTube target before starting either OBS output',()=>{
 for(const target of [{broadcastState:'complete',bound:true},{broadcastState:'revoked',bound:true},{broadcastState:'created',bound:false}]){
  const data=fixture();Object.assign(data.host.platforms.youtube,{id:'selected',channelId:'channel',...target});
  const state=liveControlState(data,true,now);
  assert.equal(state.destinations.youtube.canStart,false);
  assert.equal(state.canStartBoth,false);
  assert.match(state.destinations.youtube.startBlockReason,target.bound?/Diffusion terminée/:/sans flux lié/);
  assert.equal(state.destinations.twitch.canStart,true,'An unusable YouTube target must not prevent an individual Twitch live');
 }
});

test('never carries a YouTube start-block reason across stale observations, offline mode or a different target',()=>{
 for(const change of [
  data=>{data.host.platforms.youtube.observedAt=new Date(now-60_000).toISOString();},
  data=>{data.host.platforms.youtube.id='old-broadcast';},
  data=>{data.host.platforms.youtube.channelId='old-channel';},
 ]){
  const data=fixture();Object.assign(data.host.platforms.youtube,{id:'selected',channelId:'channel',broadcastState:'complete',bound:true});change(data);
  const state=liveControlState(data,true,now);
  assert.equal(state.destinations.youtube.live,null);
  assert.equal(state.destinations.youtube.startBlockReason,'');
  assert.equal(state.destinations.youtube.canStart,false);
 }
 const data=fixture();Object.assign(data.host.platforms.youtube,{broadcastState:'created',bound:false});
 assert.equal(liveControlState(data,false,now).destinations.youtube.startBlockReason,'');
});

test('preserves finalization of a bound target receiving video and preserves an already confirmed live',()=>{
 const data=fixture();Object.assign(data.host.platforms.youtube,{id:'selected',channelId:'channel',broadcastState:'ready',bound:true,ingestionStatus:'active'});
 data.host.outputStatus.youtube.active=true;
 const ready=liveControlState(data,true,now);
 assert.equal(ready.destinations.youtube.canStart,true);
 assert.equal(ready.destinations.youtube.startBlockReason,'');
 assert.equal(ready.canStartBoth,false);
 Object.assign(data.host.platforms.youtube,{live:true,broadcastState:'live',bound:false});
 const live=liveControlState(data,true,now);
 assert.equal(live.destinations.youtube.live,true);
 assert.equal(live.destinations.youtube.canStart,false);
 assert.equal(live.destinations.youtube.startBlockReason,'');
});
