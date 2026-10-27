import assert from 'node:assert/strict';
import {test} from 'node:test';
import {liveControlState} from '../../apps/mobile/control/live-controls.js';

/** Production contract is Twitch-only. Legacy dual-platform fixtures archived
 * under docs/legacy-tests, not silently deleted or treated as current behavior.
 */
const now=Date.parse('2026-10-27T13:20:00Z');
const at=t=>new Date(t).toISOString();
const fixture=()=>({
  configuration:{outputs:{twitch:{kind:'main',name:''}}},
  host:{
    state:{obs:{connected:true,streamingKnown:true,streaming:false}},
    platforms:{twitch:{live:false,observedAt:at(now)}},
    outputStatus:{},
  },
  receipts:[],
});

test('permits a single Twitch start only when cloud and OBS agree it is stopped',()=>{
  const state=liveControlState(fixture(),true,now);
  assert.equal(state.destinations.twitch.canStart,true);
  assert.equal(state.canStartBoth,true); // Legacy field name means "all configured destinations".
  assert.equal(state.anyActive,false);
  assert.equal(state.heading,'Préparer votre live');
});
test('an already active OBS stream cannot be started again even before Twitch catches up',()=>{
  const data=fixture();data.host.state.obs.streaming=true;
  const state=liveControlState(data,true,now);
  assert.equal(state.destinations.twitch.active,true);
  assert.equal(state.destinations.twitch.canStart,false);
  assert.equal(state.canStartBoth,false);
  assert.equal(state.anyActive,true);
  assert.equal(state.heading,'Diffusion en cours');
});
test('Twitch confirmed live disables start even if OBS falsely appears stopped',()=>{
  const data=fixture();data.host.platforms.twitch.live=true;
  const state=liveControlState(data,true,now);
  assert.equal(state.destinations.twitch.live,true);
  assert.equal(state.destinations.twitch.canStart,false);
  assert.equal(state.anyActive,true);
  assert.equal(state.heading,'En direct sur Twitch');
});
test('stale cloud status never means a safe stopped stream',()=>{
  const data=fixture();data.host.platforms.twitch.observedAt=at(now-60_000);
  const state=liveControlState(data,true,now);
  assert.equal(state.destinations.twitch.live,null);
  assert.equal(state.destinations.twitch.canStart,false);
  assert.equal(state.unconfirmed,true);
  assert.equal(state.heading,'État de diffusion à vérifier');
});
test('unknown, disconnected, or missing OBS state blocks start',()=>{
  for(const change of [
    data=>{data.host.state.obs.connected=false},
    data=>{data.host.state.obs.streamingKnown=false},
    data=>{delete data.host.state.obs.streaming},
  ]){
    const state=fixture();change(state);
    const view=liveControlState(state,true,now);
    assert.equal(view.destinations.twitch.active,null);
    assert.equal(view.destinations.twitch.canStart,false);
    assert.equal(view.unconfirmed,true);
  }
});
test('offline UI never promotes stale state to a start permission',()=>{
  const state=liveControlState(fixture(),false,now);
  assert.equal(state.destinations.twitch.live,null);
  assert.equal(state.destinations.twitch.active,null);
  assert.equal(state.destinations.twitch.canStart,false);
  assert.equal(state.heading,'Régie déconnectée');
});
test('a pending start or stop prevents overlapping live commands',()=>{
  for(const action of ['live.start','live.stop']){
    const data=fixture();
    data.receipts=[{action,status:'running'}];
    const state=liveControlState(data,true,now);
    assert.equal(state.running,true);
    assert.equal(state.destinations.twitch.canStart,false);
    assert.equal(state.heading,'Commande de diffusion en cours');
  }
});
test('an unconfigured output is never started',()=>{
  const data=fixture();data.configuration.outputs.twitch.kind='unconfigured';
  const state=liveControlState(data,true,now);
  assert.equal(state.destinations.twitch.configured,false);
  assert.equal(state.destinations.twitch.canStart,false);
});
test('retired YouTube telemetry cannot alter Twitch decisions',()=>{
  const data=fixture();
  data.configuration.outputs.youtube={kind:'aitum-suite',name:'retired output'};
  data.host.platforms.youtube={live:true,observedAt:at(now)};
  data.host.outputStatus.youtube={kind:'aitum-suite',name:'retired output',active:true,observedAt:at(now)};
  const state=liveControlState(data,true,now);
  assert.equal(Object.hasOwn(state.destinations,'youtube'),false);
  assert.equal(state.destinations.twitch.canStart,true);
  assert.equal(state.anyActive,false);
});
test('future cloud snapshots beyond the clock-skew allowance are not trusted',()=>{
  const data=fixture();data.host.platforms.twitch.observedAt=at(now+10_000);
  assert.equal(liveControlState(data,true,now).destinations.twitch.live,null);
  assert.equal(liveControlState(data,true,now).destinations.twitch.canStart,false);
});
