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
