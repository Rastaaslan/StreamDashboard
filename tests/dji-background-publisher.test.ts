import {describe,expect,it,vi} from 'vitest';
import {DjiBackgroundPublisher} from '../apps/desktop/src/dji-background-publisher.js';
import {djiNotificationDefinition} from '../apps/desktop/src/dji-notification.js';

const installation={
  localDeviceId:'laptop',
  routes:{obs:'fixed'},
  devices:[
    {id:'laptop',enabled:true,endpoint:'',roles:['audio']},
    {id:'fixed',enabled:true,endpoint:'https://192.168.1.15:48136',roles:['obs-executor']},
  ],
};
function measurement(){
 return {status:'ok',source:'dji-mic3-rx-winusb',validFrames:32,
   rx:{rawGauge:1,level:'uncalibrated',percent:null},
   tx:[{slot:2,connected:true,rawGauge:3,level:'uncalibrated',percent:null}]};
}
describe('Desktop main-process DJI relay',()=>{
 it('uses a pinned already configured remote OBS executor, independent of UI pages',async()=>{
  const send=vi.fn(async(_target:string,_m:unknown)=>undefined);
  const pub=new DjiBackgroundPublisher({topology:async()=>installation,localRead:async()=>measurement(),send});
  expect(await pub.tick()).toBe(true);
  expect(send).toHaveBeenCalledWith('https://192.168.1.15:48136',expect.objectContaining({source:'dji-mic3-rx-winusb'}));
  pub.stop();
 });
 it('does not send to any host when topology is missing',async()=>{
  const send=vi.fn(async()=>undefined);
  const pub=new DjiBackgroundPublisher({
   topology:async()=>({...installation,routes:{obs:'unknown'},devices:[]}),
   localRead:async()=>measurement(),send});
  expect(await pub.tick()).toBe(false);
  expect(send).not.toHaveBeenCalled();pub.stop();
 });
 it('sends a single unavailable tombstone after a working sensor is disconnected',async()=>{
  let state:any=measurement();
  const send=vi.fn(async()=>undefined);
  const pub=new DjiBackgroundPublisher({
   topology:async()=>installation,localRead:async()=>state,send});
  await pub.tick();
  state={status:'unavailable',reason:'receiver-unavailable'};
  expect(await pub.tick()).toBe(true);
  expect(await pub.tick()).toBe(false);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith(installation.devices[1].endpoint,state);
  pub.stop();
 });
 it('coalesces concurrent requests without duplicating USB work',async()=>{
  let resolve!: (x:unknown)=>void;
  const localRead=vi.fn(()=>new Promise<unknown>(r=>{resolve=r;}));
  const send=vi.fn(async()=>undefined);
  const pub=new DjiBackgroundPublisher({topology:async()=>installation,localRead,send});
  const first=pub.tick(),second=pub.tick();
  await Promise.resolve();await Promise.resolve();
  resolve(measurement());
  expect(await first).toBe(true);
  expect(await second).toBe(true);
  expect(localRead).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
  pub.stop();
 });
 it('does not dispatch after it was stopped during a pending USB read',async()=>{
  let resolve!: (x:unknown)=>void;
  const send=vi.fn(async()=>undefined);
  const pub=new DjiBackgroundPublisher({
   topology:async()=>installation,
   localRead:()=>new Promise(r=>{resolve=r}),
   send});
  const tick=pub.tick();
  await Promise.resolve();await Promise.resolve();
  pub.stop();
  resolve(measurement());
  expect(await tick).toBe(false);
  expect(send).not.toHaveBeenCalled();
 });
});
describe('OS notification allowlist',()=>{
 it('only accepts fixed, non-user-controlled notification bodies',()=>{
  expect(djiNotificationDefinition('tx2-disconnected')).toMatchObject({critical:true});
  expect(djiNotificationDefinition('telemetry-lost')).toMatchObject({critical:true});
  expect(djiNotificationDefinition('rx-gauge-7')?.body).toContain('Pas de pourcentage calibré');
  expect(djiNotificationDefinition('fake')).toBeNull();
  expect(djiNotificationDefinition('<script>alert(1)</script>')).toBeNull();
  expect(djiNotificationDefinition({code:'tx2-disconnected'})).toBeNull();
 });
});
