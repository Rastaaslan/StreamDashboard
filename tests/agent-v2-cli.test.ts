import {describe,it,expect} from 'vitest';
import {readOnlyCliConfig} from '../apps/agent/src/readonly-cli.js';
describe('read-only OBS CLI startup rules',()=>{
 it('requires a named device and local OBS credential',()=>{
  expect(()=>readOnlyCliConfig({})).toThrow('AGENT_DEVICE_ID_REQUIRED');
  expect(()=>readOnlyCliConfig({STREAMDASHBOARD_AGENT_DEVICE_ID:'pc-stream'})).toThrow('OBS_PASSWORD_REQUIRED');
 });
 it('never accepts a remote or URL-embedded password',()=>{
  const env={STREAMDASHBOARD_AGENT_DEVICE_ID:'pc-stream',STREAMDASHBOARD_AGENT_OBS_PASSWORD:'not-output',
   STREAMDASHBOARD_AGENT_OBS_URL:'ws://192.168.1.2:4455'};
  expect(()=>readOnlyCliConfig(env)).toThrow('loopback');
  expect(()=>readOnlyCliConfig({...env,STREAMDASHBOARD_AGENT_OBS_URL:'ws://user:pass@localhost:4455'})).toThrow('loopback');
 });
 it('returns sanitized local URL while retaining password only internally',()=>{
  const result=readOnlyCliConfig({STREAMDASHBOARD_AGENT_DEVICE_ID:'pc-stream',STREAMDASHBOARD_AGENT_OBS_PASSWORD:'secret'});
  expect(result.obsUrl).toBe('ws://127.0.0.1:4455/');
  expect(result.deviceId).toBe('pc-stream');
 });
});

[executed on device: dam-server (ee881f3f-7909-4993-a915-04a1d994f366)]