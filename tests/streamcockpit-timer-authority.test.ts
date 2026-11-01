import {describe,it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startDashboardServer,type DashboardServerHandle} from '../apps/server/src/index.js';
// @ts-expect-error Display-only browser JS helper.
import {sampleMasterClock,masterTimerSeconds} from '../apps/mobile/control/streamcockpit-master-clock.js';

const ports:DashboardServerHandle[]=[],folders:string[]=[];
async function make(timerAuthority:boolean){
 const dir=await mkdtemp(path.join(tmpdir(),'streamcockpit-timer-test-'));folders.push(dir);
 const server=await startDashboardServer({port:0,dataDir:dir,remoteEnabled:false,obsEnabled:false,
  timerAuthority,logger:{info(){},warn(){},error(){}}});ports.push(server);return server;
}
const command=(url:string,type:string,commandId:string,extra:Record<string,unknown>={})=>
 fetch(url+'/api/v1/commands',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({type,commandId,...extra})});
describe('FC1: one timer authority over two independent server instances',()=>{
 it('rejects local client timer writes while host accepts them; no state replay or double start',async()=>{
  const host=await make(true),client=await make(false);
  try{
   const beforeClient=await fetch(client.url+'/api/v1/state').then(r=>r.json());
   for(const type of ['timer.start','timer.pause','timer.reset','timer.add']){
    const denied=await command(client.url,type,'client_'+type.replace('.','_')+'_'+Date.now(),type==='timer.add'?{seconds:60}:{});
    expect(denied.ok).toBe(false);
   }
   const afterClient=await fetch(client.url+'/api/v1/state').then(r=>r.json());
   expect(afterClient.timer).toEqual(beforeClient.timer);
   const start=await command(host.url,'timer.start','host_start_'+Date.now(),{seconds:600});
   expect(start.status).toBe(200);
   const response=await start.json();expect(response.state.timer.running).toBe(true);
   expect(response.state.timer.duration).toBe(600);
   const hostState=await fetch(host.url+'/api/v1/state').then(r=>r.json());
   expect(hostState.timer.deadline).toBe(response.state.timer.deadline);
   // GET /api/v2/autonomy returns the current FIXE clock alongside its timer
   // in a real loopback HTTP response, not a local Android/PC-game clock.
   const replicaResponse=await fetch(host.url+'/api/v2/autonomy');
   expect(replicaResponse.status).toBe(200);
   expect(replicaResponse.headers.get('cache-control')).toContain('no-store');
   const replica=await replicaResponse.json();
   const observed=replica.bundle.data.host.timerObservedAt;
   expect(Number.isSafeInteger(observed)).toBe(true);
   const sample=sampleMasterClock(observed,1000,host.url);
   const seconds=masterTimerSeconds(replica.bundle.data.host.state.timer,sample,1250,host.url,true);
   expect(seconds).toBeGreaterThan(598);
   expect(seconds).toBeLessThanOrEqual(600);
   expect(masterTimerSeconds(replica.bundle.data.host.state.timer,sample,1250,client.url,true)).toBeNull();
   expect((await fetch(client.url+'/api/v1/state').then(r=>r.json())).timer.running).toBe(false);
   const pause=await command(host.url,'timer.pause','host_pause_'+Date.now());
   expect(pause.status).toBe(200);
  }finally{await Promise.all(ports.splice(0).map(value=>value.stop()));await Promise.all(folders.splice(0).map(value=>rm(value,{recursive:true,force:true})))}
 });
});
