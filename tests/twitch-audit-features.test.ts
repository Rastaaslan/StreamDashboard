import { describe, expect, it, vi } from 'vitest';
import { MicHealthWatch } from '../integrations/obs/src/mic-health.js';
import { SpotifyLocalController } from '../apps/server/src/spotify-local.js';
import { isRemoteApiAllowed, requiredDevicePermissions } from '../apps/server/src/remote-api-policy.js';

describe('DJI microphone audio safety monitor', () => {
 it('shows unavailable battery and never invents a percentage', () => {
   const m=new MicHealthWatch();m.updateStream(true,0);
   const snapshot=m.state('micro',{connected:true,streaming:true,exists:true,muted:false},10_000);
   expect(snapshot.state).toBe('unavailable');expect(snapshot.batteryPercent).toBe(null);
 });
 it('detects a missing and muted source independently of silence', () => {
   const m=new MicHealthWatch();m.updateStream(true,0);
   expect(m.state('micro',{connected:true,streaming:true,exists:false}).warning).toMatch(/introuvable/);
   expect(m.state('micro',{connected:true,streaming:true,exists:true,muted:true}).state).toBe('muted');
 });
 it('does not call silence a battery failure and resets after new audio', () => {
   const m=new MicHealthWatch();m.updateStream(true,1000);
   m.observe([{inputName:'micro',inputLevelsMul:[[0.23,0.1]]}],2_000);
   expect(m.state('micro',{connected:true,streaming:true,exists:true,muted:false},3_000).state).toBe('healthy');
   m.observe([{inputName:'micro',inputLevelsMul:[[0.0,0]]}],74_000);
   const quiet=m.state('micro',{connected:true,streaming:true,exists:true,muted:false},74_000);
   expect(quiet.state).toBe('monitoring');expect(quiet.warning).toBeNull();
   expect(quiet.batteryPercent).toBe(null);
   m.observe([{inputName:'micro',inputLevelsMul:[[0.14,0.12]]}],75_000);
   expect(m.state('micro',{connected:true,streaming:true,exists:true,muted:false},75_100).state).toBe('healthy');
   m.updateStream(false,76_000);
   expect(m.state('micro',{connected:true,streaming:false,exists:true,muted:false},76_100).state).toBe('idle');
 });
 it('does not warn about silence without fresh meter telemetry', () => {
   const m=new MicHealthWatch();m.updateStream(true,100);
   m.observe([{inputName:'micro',inputLevelsMul:[[0.5]]}],200);
   expect(m.state('micro',{connected:true,streaming:true,exists:true,muted:false},90_000).state).toBe('unavailable');
 });
});
describe('Spotify local-only controller', () => {
 it('rejects unknown actions without starting any process', async () => {
   const run=vi.fn(async ()=>'{}'); const c=new SpotifyLocalController(run);
   await expect(c.control('arbitrary' as never)).rejects.toThrow('inconnue');
   expect(run).not.toHaveBeenCalled();
 });
 it('exposes only authenticated read/command routes with audio capability', () => {
   expect(isRemoteApiAllowed('GET','/v1/spotify/status')).toBe(true);
   expect(isRemoteApiAllowed('POST','/v1/spotify/control')).toBe(true);
   expect(requiredDevicePermissions('POST','/v1/spotify/control',{})).toEqual(['audio']);
   expect(isRemoteApiAllowed('POST','/v1/youtube/prepare')).toBe(false);
 });
});
