import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ControlService, type ControlAdapter } from '../apps/server/src/control-service.js';
import type { Platform } from '../packages/contracts/src/control.js';
const dirs:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
const command=(action:string,id:string,platform?:Platform)=>({action,id,issuedAt:new Date().toISOString(),...(platform?{platform}:{})});
async function open(overrides:Partial<ControlAdapter>={}){
 const dir=await mkdtemp(path.join(tmpdir(),'sd-stop-'));dirs.push(dir);
 const adapter:ControlAdapter={live:vi.fn(async()=>false),output:vi.fn(async()=>{}),metadata:vi.fn(async()=>{}),action:vi.fn(async()=>{}),...overrides};
 return {adapter,control:await ControlService.open(path.join(dir,'control.json'),adapter,()=>{},async()=>{})};
}
describe('Stop always reaches the local outputs',()=>{
 it('sends both stops before provider quota errors, preserving an uncertain cloud result',async()=>{
  const calls:string[]=[];const {control,adapter}=await open({
   live:async p=>{calls.push('read:'+p);throw Error('quotaExceeded');},
   output:vi.fn(async p=>{calls.push('stop:'+p);}),
   settle:async()=>{throw Error('quotaExceeded');}
  });
  const result=await control.execute(command('live.stop','stop_quota_001'));
  expect(vi.mocked(adapter.output).mock.calls).toEqual([['twitch',false],['youtube',false]]);
  expect(calls).toEqual(['stop:twitch','stop:youtube']);
  expect(result.status).toBe('uncertain');expect(result.platforms?.youtube?.message).toContain('Ordre d’arrêt envoyé à OBS');
  await control.stop();
 });
 it('does not let a slow Twitch confirmation delay the YouTube output stop',async()=>{
  const gate=deferred(),entered=deferred();const {control,adapter}=await open({settle:async p=>{if(p==='twitch'){entered.resolve();await gate.promise;}}});
  const pending=control.execute(command('live.stop','stop_parallel_1'));await entered.promise;
  expect(adapter.output).toHaveBeenCalledWith('youtube',false);gate.resolve();expect((await pending).status).toBe('succeeded');await control.stop();
 });
 it('interrupts a start observation and stops without waiting 31 seconds or replaying the start',async()=>{
  const gate=deferred(),entered=deferred();let active=false,signal:AbortSignal|undefined;
  const {control,adapter}=await open({live:async()=>active,output:vi.fn(async(_p,wanted)=>{active=wanted;}),settle:async(_p,wanted,_id,s)=>{if(wanted){signal=s;entered.resolve();await gate.promise;}}});
  const started=control.execute(command('live.start','start_wait_0001','youtube'));await entered.promise;
  const issued=command('live.stop','stop_wait_0001','youtube');
  const realNow=Date.now;vi.spyOn(Date,'now').mockImplementation(()=>realNow()+31000);
  // Still fresh on admission; the start already spent 31 seconds settling.
  issued.issuedAt=new Date(Date.now()).toISOString();
  const stopped=await control.execute(issued);
  expect(signal?.aborted).toBe(true);expect(stopped.status).toBe('succeeded');
  expect((await started).status).toBe('uncertain');expect(active).toBe(false);
  gate.resolve();expect(vi.mocked(adapter.output).mock.calls).toEqual([['youtube',true],['youtube',false]]);await control.stop();
 });
 it('cancels a preflight before any late start effect and prioritizes stop ahead of queued actions',async()=>{
  const gate=deferred(),entered=deferred(),order:string[]=[];
  const {control}=await open({preflight:async()=>{entered.resolve();await gate.promise;},output:async(_p,wanted)=>{order.push(wanted?'start':'stop');},action:async()=>{order.push('micro');}});
  const started=control.execute(command('live.start','start_preflight_1','youtube'));await entered.promise;
  const micro=control.execute(command('micro','micro_queued_001'));
  const stopped=control.execute(command('live.stop','stop_preflight_1','youtube'));
  await Promise.all([started,micro,stopped]);gate.resolve();await Promise.resolve();
  expect(order).toEqual(['stop','micro']);await control.stop();
 });
 it('does not cancel a start when the stop permission is denied',async()=>{
  const gate=deferred(),entered=deferred();let active=false;
  const {control,adapter}=await open({live:async()=>active,preflight:async()=>{entered.resolve();await gate.promise;},output:vi.fn(async(_p,wanted)=>{active=wanted;})});
  const started=control.execute(command('live.start','start_allowed_1','youtube'));await entered.promise;
  await expect(control.execute(command('live.stop','stop_denied_001','youtube'),()=>{throw Error('Permission revoked');})).rejects.toThrow('Permission revoked');
  gate.resolve();expect((await started).status).toBe('succeeded');expect(adapter.output).toHaveBeenCalledExactlyOnceWith('youtube',true);await control.stop();
 });
 it('keeps an admitted stop executable even after a previous local action used its age budget',async()=>{
  const gate=deferred(),entered=deferred();const {control,adapter}=await open({action:async()=>{entered.resolve();await gate.promise;}});
  const action=control.execute(command('micro','micro_delayed_01'));await entered.promise;
  const stop=control.execute(command('live.stop','stop_delayed_01','youtube'));await Promise.resolve();
  const now=Date.now;vi.spyOn(Date,'now').mockImplementation(()=>now()+31000);gate.resolve();
  expect((await stop).status).toBe('succeeded');await action;expect(adapter.output).toHaveBeenCalledWith('youtube',false);await control.stop();
 });
});
