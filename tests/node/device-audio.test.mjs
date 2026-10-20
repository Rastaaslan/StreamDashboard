import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceAudio} from '../../apps/mobile/control/device-audio.js';

function fixture(){
 let time=1000,assetWait,playWait;const sounds=[{id:'a',name:'Cloche',enabled:true,volume:.35,cooldownMs:500},{id:'b',name:'Feu',enabled:true,volume:1}];
 const media=[],revoked=[],errors=[];
 const store={record:{localAssets:{a:{},b:{}}},view:()=>({sounds:{sounds}}),reload:async()=>{},soundAsset:async()=>{if(assetWait)await assetWait;return new Blob(['audio']);}};
 const player=createDeviceAudio({store,now:()=>time,onError:error=>errors.push(error),urls:{createObjectURL:()=>`blob:${media.length}`,revokeObjectURL:value=>revoked.push(value)},createAudio:url=>{const audio={url,pauses:0,volume:1,play:()=>playWait||Promise.resolve(),pause(){this.pauses++;},load(){},removeAttribute(){}};media.push(audio);return audio;}});
 return {player,store,sounds,media,revoked,errors,time:value=>{time=value;},waitAsset:value=>{assetWait=value;},waitPlay:value=>{playWait=value;}};
}

test('autonomous playback uses local blobs, actual volume, one active sound and releases URLs',async()=>{
 const s=fixture();assert.equal(s.player.snapshot().localPlayback,true);assert.equal(s.player.snapshot().sounds[0].sourceAvailable,true);
 await s.player.play('a');assert.equal(s.media[0].volume,.35);assert.equal(s.player.snapshot().currentPlayback.soundId,'a');
 s.sounds[0].volume=.8;s.player.snapshot();assert.equal(s.media[0].volume,.8);
 await s.player.play('b');assert.equal(s.media[0].pauses,1);assert.deepEqual(s.revoked,['blob:0']);
 s.media[1].onended();assert.equal(s.player.snapshot().currentPlayback,null);assert.deepEqual(s.revoked,['blob:0','blob:1']);
});
test('stop cancels a pending asset read and a late play result cannot resurrect playback',async()=>{
 const s=fixture();let resolveAsset;s.waitAsset(new Promise(resolve=>{resolveAsset=resolve;}));
 const pending=s.player.play('a');await new Promise(resolve=>setImmediate(resolve));assert.equal(s.player.snapshot().currentPlayback.status,'starting');s.player.stop();resolveAsset();
 await assert.rejects(pending,{code:'CANCELED'});assert.equal(s.media.length,0);
 s.waitAsset(null);let resolvePlay;s.waitPlay(new Promise(resolve=>{resolvePlay=resolve;}));
 const playing=s.player.play('a');await new Promise(resolve=>setImmediate(resolve));s.player.stop();resolvePlay();
 await assert.rejects(playing,{code:'CANCELED'});assert.equal(s.media[0].pauses,1);assert.deepEqual(s.revoked,['blob:0']);assert.equal(s.player.snapshot().currentPlayback,null);
});
test('disabled, missing and cooldown sounds refuse without queuing; dispose stops the previous workspace',async()=>{
 const s=fixture();s.sounds[0].enabled=false;await assert.rejects(s.player.play('a'),/désactivé/);assert.equal(s.media.length,0);
 s.sounds[0].enabled=true;await s.player.play('a');await assert.rejects(s.player.play('a'),/Patientez/);assert.equal(s.media.length,1);
 s.time(1600);await s.player.play('a');assert.equal(s.media.length,2);
 s.player.dispose();assert.equal(s.media[1].pauses,1);await assert.rejects(s.player.play('b'),{code:'CANCELED'});
 const missing=fixture();delete missing.store.record.localAssets.a;missing.store.soundAsset=async()=>null;
 assert.equal(missing.player.snapshot().sounds[0].sourceAvailable,false);await assert.rejects(missing.player.play('a'),/Réimportez/);
});
test('play failures and runtime media errors never leave a false playing state',async()=>{
 const failed=fixture();failed.waitPlay(Promise.reject(new Error('unsupported')));await assert.rejects(failed.player.play('a'),/Lecture audio impossible/);
 assert.equal(failed.player.snapshot().currentPlayback,null);assert.equal(failed.revoked.length,1);
 const s=fixture();await s.player.play('a');s.media[0].onerror();assert.equal(s.player.snapshot().currentPlayback,null);assert.equal(s.errors.length,1);assert.equal(s.revoked.length,1);
});

test('stop remains successful when the media play promise rejects after cancellation',async()=>{
 const s=fixture();let rejectPlay;s.waitPlay(new Promise((_,reject)=>{rejectPlay=reject;}));
 const pending=s.player.play('a');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.player.snapshot().currentPlayback.status,'starting');s.player.stop();rejectPlay(new DOMException('Stopped','AbortError'));
 await assert.rejects(pending,{code:'CANCELED'});assert.equal(s.player.snapshot().currentPlayback,null);assert.equal(s.errors.length,0);assert.equal(s.revoked.length,1);
});
