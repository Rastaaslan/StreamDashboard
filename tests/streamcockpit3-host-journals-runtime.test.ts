import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HostWindowsDurableJournals} from '../apps/server/src/streamcockpit-host-journals.js';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})});
const fixture=async()=>{
  const root=await mkdtemp(join(tmpdir(),'sc3-prod-host-journals-'));
  roots.push(root);
  return {root,host:new HostWindowsDurableJournals(root)};
};
const windows=process.platform==='win32'?it:it.skip;

windows('F10 production adapter owns all F02/F08/F09 writes, with a single lazy F09 SQLite instance',async()=>{
  const {host}=await fixture();
  expect(host.gate.status).toMatchObject({phase:'active',coverage:['automod','prediction']});
  await expect(host.gate.withQuiesced(async()=>true)).rejects.toThrow('COVERAGE_INCOMPLETE');
  const [moments,other,third]=await Promise.all([
    host.momentsStorage(),host.momentsStorage(),host.momentsStorage()]);
  expect(other).toBe(moments);
  expect(third).toBe(moments);
  expect(host.gate.status.coverage).toEqual(['automod','moments','prediction']);
  expect(host.automod.reserve('42','held-1','12','DENY')).toBe(true);
  expect(host.prediction.reserve('42')).toBe(true);
  expect(await moments.compareAndSwap(null,'first durable marker')).toBe(true);
  expect(host.automod.isBlocked('42','held-1')).toBe(true);
  expect(host.prediction.isBlocked('42')).toBe(true);
  expect(await moments.read()).toBe('first durable marker');
  expect(await host.gate.withQuiesced(async()=>{
    host.gate.assertQuiesced();
    expect(()=>host.automod.reserve('42','held-2','12','ALLOW')).toThrow('PAUSED_OR_BLOCKED');
    expect(()=>host.prediction.reserve('43')).toThrow('PAUSED_OR_BLOCKED');
    expect(()=>moments.compareAndSwap('first durable marker','second')).toThrow('PAUSED_OR_BLOCKED');
    expect(await moments.read()).toBe('first durable marker');
    return 'maintenance-without-effects';
  })).toBe('maintenance-without-effects');
  expect(host.gate.status).toMatchObject({phase:'active',active:0});
  expect(host.automod.reserve('42','held-2','12','ALLOW')).toBe(true);
  expect(host.prediction.reserve('43')).toBe(true);
  expect(await moments.compareAndSwap('first durable marker','second')).toBe(true);
});

windows('F10 real host journal receipts survive an independent controller instance',async()=>{
  const {root,host}=await fixture();
  const f09=await host.momentsStorage();
  expect(host.automod.reserve('42','held-a','12','ALLOW')).toBe(true);
  expect(host.prediction.reserve('42')).toBe(true);
  expect(await f09.compareAndSwap(null,'persisted marker')).toBe(true);
  const restarted=new HostWindowsDurableJournals(root);
  const loaded=await restarted.momentsStorage();
  expect(restarted.automod.isBlocked('42','held-a')).toBe(true);
  expect(restarted.automod.reserve('42','held-a','12','ALLOW')).toBe(false);
  expect(restarted.prediction.isBlocked('42')).toBe(true);
  expect(await loaded.read()).toBe('persisted marker');
  expect(await loaded.compareAndSwap(null,'silent replay')).toBe(false);
  expect(await loaded.read()).toBe('persisted marker');
});

windows('F10 an uncertain production writer poisons subsequent maintenance and writes instead of replay',async()=>{
  const {host}=await fixture();
  const moments=await host.momentsStorage();
  await moments.compareAndSwap(null,'witness');
  expect(()=>host.prediction.reserve('invalid-id')).toThrow();
  expect(host.gate.status).toMatchObject({phase:'blocked'});
  await expect(host.gate.withQuiesced(async()=>true)).rejects.toThrow('MAINTENANCE_UNAVAILABLE');
  expect(()=>host.automod.reserve('42','held-b','12','ALLOW')).toThrow('PAUSED_OR_BLOCKED');
  expect(()=>moments.compareAndSwap('witness','retry')).toThrow('PAUSED_OR_BLOCKED');
  expect(await moments.read()).toBe('witness');
});

windows('F10 invalid or legacy F09 journal fails closed without resetting production receipts',async()=>{
  const {root,host}=await fixture();
  await writeFile(join(root,'streamcockpit-moments.json'),'unreviewed legacy payload',{flag:'wx'});
  const moments=await host.momentsStorage();
  const original=await readFile(join(root,'streamcockpit-moments.json'));
  await expect(moments.compareAndSwap(null,'unsafe')).rejects.toThrow();
  expect(host.gate.status.phase).toBe('blocked');
  expect(await readFile(join(root,'streamcockpit-moments.json'))).toEqual(original);
  await expect(host.gate.withQuiesced(async()=>true)).rejects.toThrow('MAINTENANCE_UNAVAILABLE');
});

windows('F10 actual DashboardServer starts and stops on isolated Windows data without OBS or an installer',async()=>{
  const {root}=await fixture();
  const {startDashboardServer}=await import('../apps/server/src/index.js');
  const server=await startDashboardServer({
    port:0,dataDir:root,obsEnabled:false,timerAuthority:false,remoteEnabled:false,
    logger:{info(){},warn(){},error(){}},
  });
  try{
    const response=await fetch(server.url+'/api/diagnostics');
    expect(response.status).toBe(200);
    const body=await response.json() as {runtime:{port:number}};
    expect(body.runtime.port).toBe(server.port);
    expect((await server.assessRestartSafety()).safe).toBe(true);
  }finally{
    await server.stop();
    expect(server.server.listening).toBe(false);
  }
});
