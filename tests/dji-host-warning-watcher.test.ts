import {describe,expect,it,vi} from 'vitest';
import {DjiHostWarningWatcher} from '../apps/desktop/src/dji-host-warning-watcher.js';

function packet(at:number, connected=true, gauge=3){
 return {
  status:'ok',source:'dji-mic3-rx-winusb',observedAt:new Date(at).toISOString(),
  validFrames:31,audioHealthy:true,
  tx:[{slot:1,connected:false,rawGauge:null},{slot:2,connected,rawGauge:connected?gauge:null}],
  rx:{rawGauge:1,percent:null,level:'uncalibrated'},
 };
}
describe('DJI host notification watchdog when windows are minimized',()=>{
 it('never contacts the RX or notifies users when OBS streaming is stopped',async()=>{
  const read=vi.fn(async()=>packet(Date.now()));
  const notify=vi.fn();
  const watcher=new DjiHostWarningWatcher({streaming:()=>false,read,notify});
  await watcher.tick();
  expect(read).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
  watcher.stop();
 });
 it('notifies after a previously present TX2 disappears midstream',async()=>{
  let live=true;
  let status=packet(Date.now(),true);
  const notify=vi.fn();
  const watcher=new DjiHostWarningWatcher({streaming:()=>live,read:async()=>status,notify});
  await watcher.tick();
  expect(notify).not.toHaveBeenCalled();
  status=packet(Date.now(),false);
  await watcher.tick();
  expect(notify).toHaveBeenCalledWith('tx2-disconnected');
  live=false;await watcher.tick();watcher.stop();
 });
 it('only emits coarse high gauge checks, never fabricated battery percentages',async()=>{
  const notify=vi.fn();
  const watcher=new DjiHostWarningWatcher({streaming:()=>true,
    read:async()=>packet(Date.now(),true,7),notify});
  await watcher.tick();
  expect(notify).toHaveBeenCalledWith('tx2-gauge-7');
  watcher.stop();
 });
 it('does not send repeated notifications while a read is pending',async()=>{
  let resolve!: (packet:unknown)=>void;
  const read=vi.fn(()=>new Promise(r=>{resolve=r}));
  const notify=vi.fn();
  const watcher=new DjiHostWarningWatcher({streaming:()=>true,read,notify});
  const one=watcher.tick(),two=watcher.tick();
  resolve(packet(Date.now(),true,7));
  await Promise.all([one,two]);
  expect(read).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledTimes(1);
  watcher.stop();
 });
 it('can stop safely during delayed HTTP reads',async()=>{
  let resolve!: (packet:unknown)=>void;
  const notify=vi.fn();
  const watcher=new DjiHostWarningWatcher({
   streaming:()=>true,read:()=>new Promise(r=>{resolve=r}),notify});
  const p=watcher.tick();watcher.stop();resolve(packet(Date.now(),true,7));await p;
  expect(notify).not.toHaveBeenCalled();
 });
});
