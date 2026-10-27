import {describe,expect,it} from 'vitest';
import {djiRelayTarget} from '../apps/mobile/control/dji-relay-target.js';

const topology={
  localDeviceId:'laptop',
  routes:{obs:'fixed'},
  devices:[
    {id:'laptop',enabled:true,endpoint:'',roles:['audio']},
    {id:'legacy',enabled:true,endpoint:'http://10.0.0.2:48133',roles:['obs-executor']},
    {id:'fixed',enabled:true,endpoint:'https://192.168.1.15:48136',roles:['obs-executor']},
  ],
};
describe('DJI batteries publish to the registered remote OBS executor',()=>{
 it('uses the already registered fixed host while the UI is in local workspace mode',()=>{
   expect(djiRelayTarget({installation:topology,activeServer:'http://127.0.0.1:48135',localEndpoint:'http://127.0.0.1:48135'}))
    .toBe('https://192.168.1.15:48136');
 });
 it('rejects a different untrusted endpoint even when manually selected',()=>{
   const t={...topology,routes:{obs:'missing'}};
   expect(djiRelayTarget({installation:t,activeServer:'https://10.0.0.99:48136'})).toBe('');
 });
 it('never publishes to a legacy unencrypted OBS executor',()=>{
   const t={...topology,routes:{obs:'legacy'}};
   expect(djiRelayTarget({installation:t,activeServer:'http://10.0.0.2:48133'})).toBe('');
 });
 it('never publishes to a disabled or local machine',()=>{
   const t={...topology,devices:topology.devices.map(d=>d.id==='fixed'?{...d,enabled:false}:d)};
   expect(djiRelayTarget({installation:t,activeServer:'http://127.0.0.1:48135'})).toBe('');
   expect(djiRelayTarget({installation:null,activeServer:'https://192.168.1.15:48136'})).toBe('');
 });
 it('permits an explicitly active registered peer when the OBS route is missing',()=>{
   const t={...topology,routes:{}};
   expect(djiRelayTarget({installation:t,activeServer:'https://192.168.1.15:48136'}))
    .toBe('https://192.168.1.15:48136');
 });
});
