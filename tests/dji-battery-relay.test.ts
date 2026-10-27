import { describe, expect, it } from 'vitest';
import { DjiBatteryRelay } from '../apps/server/src/dji-battery-relay.js';
import { isRemoteApiAllowed, requiredDevicePermissions } from '../apps/server/src/remote-api-policy.js';

const current = () => ({
  status: 'ok', source: 'dji-mic3-rx-winusb',
  observedAt: new Date().toISOString(), validFrames: 31,
  audioHealthy: true,
  rx: {level:'uncalibrated',rawGauge:1,calibration:'raw-only',percent:null},
  tx: [
    {slot:1,connected:false,rawGauge:null,charging:null,level:'unknown',percent:null},
    {slot:2,connected:true,rawGauge:4,charging:false,level:'uncalibrated',percent:null},
  ],
});
describe('DJI battery relay security and expiry', () => {
 it('accepts only recent CRC-validated observations from a paired device identity', () => {
   const relay = new DjiBatteryRelay();
   const state=relay.receive('paired-laptop',current());
   expect(state.status).toBe('ok');
   expect(state.observation.tx[1]).toMatchObject({slot:2,rawGauge:4,percent:null});
   expect(relay.snapshot()?.observation.rx).toMatchObject({rawGauge:1,calibration:'raw-only',percent:null});
 });
 it('rejects invalid, stale, and forged raw measurements', () => {
   const relay=new DjiBatteryRelay();
   expect(()=>relay.receive('',current())).toThrow('associé');
   const stale=current();stale.observedAt='2023-01-01T01:00:00.000Z';
   expect(()=>relay.receive('paired-laptop',stale)).toThrow('périmée');
   const withoutCRC=current();withoutCRC.validFrames=0;
   expect(()=>relay.receive('paired-laptop',withoutCRC)).toThrow('vérifiée');
   const fake=current();fake.source='untrusted-provider';
   expect(()=>relay.receive('paired-laptop',fake)).toThrow('incohérents');
 });
 it('invalidates a device report after the freshness window without manual cleanup', () => {
   let clock=Date.now();
   const relay=new DjiBatteryRelay(()=>clock);
   relay.receive('paired-laptop',current());
   expect(relay.snapshot()).not.toBeNull();
   clock+=90_001;
   expect(relay.snapshot()).toBeNull();
 });
 it('permits remote read to an observer but requires audio permission for telemetry writes', () => {
   expect(isRemoteApiAllowed('GET','/v1/dji/overview')).toBe(true);
   expect(isRemoteApiAllowed('POST','/v1/dji/telemetry')).toBe(true);
   expect(isRemoteApiAllowed('POST','/v1/dji/overview')).toBe(false);
   expect(isRemoteApiAllowed('GET','/v1/dji/mic-battery')).toBe(false);
   expect(requiredDevicePermissions('GET','/v1/dji/overview',undefined)).toEqual(['observe']);
   expect(requiredDevicePermissions('POST','/v1/dji/telemetry',{})).toEqual(['audio']);
 });
 it('shows RX disconnected as unavailable instead of retaining a stale full badge', () => {
   const relay=new DjiBatteryRelay();
   relay.receive('paired-laptop',current());
   const report=relay.receive('paired-laptop',{status:'unavailable',reason:'receiver-unavailable'});
   expect(report.status).toBe('unavailable');
   expect(relay.snapshot()?.observation.status).toBe('unavailable');
 });
});
