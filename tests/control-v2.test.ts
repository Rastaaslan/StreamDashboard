import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ControlService, type ControlAdapter } from '../apps/server/src/control-service.js';
import { defaultControlData, type Platform } from '../packages/contracts/src/control.js';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { RemoteAuth } from '../apps/server/src/remote-auth.js';

const directories: string[]=[];const servers:DashboardServerHandle[]=[];
afterEach(async()=>{for(const server of servers.splice(0))await server.stop();for(const dir of directories.splice(0))await rm(dir,{recursive:true,force:true});});
async function temporary(){const dir=await mkdtemp(path.join(os.tmpdir(),'sd2-test-'));directories.push(dir);return dir;}
const request=(action:string,id='command_123456',platform?:Platform)=>({id,issuedAt:new Date().toISOString(),action,...(platform?{platform}:{})});
function adapter():ControlAdapter {return {live:vi.fn(async()=>false),output:vi.fn(async()=>{}),metadata:vi.fn(async()=>{}),action:vi.fn(async()=>{})};}

describe('Shared durable controller',()=>{
 it('persists the intent before a side effect and deduplicates simultaneous devices and later restart',async()=>{
  const file=path.join(await temporary(),'control.json');const a=adapter();a.action=vi.fn(async()=>{const disk=JSON.parse(await readFile(file,'utf8'));expect(disk.receipts[0].status).toBe('running');});
  const control=await ControlService.open(file,a);
  const [first,duplicate]=await Promise.all([control.execute(request('micro')),control.execute(request('micro','command_654321'))]);
  expect(first.status).toBe('succeeded');expect(duplicate.id).toBe(first.id);expect(a.action).toHaveBeenCalledTimes(1);
  const reopened=await ControlService.open(file,a);expect((await reopened.execute(request('micro'))).status).toBe('succeeded');expect(a.action).toHaveBeenCalledTimes(1);
  await expect(reopened.execute(request('scene-live'))).rejects.toThrow('Identifiant');
 });
 it('returns partial results and retries only the failed platform without restarting Twitch',async()=>{
  const active={twitch:false,youtube:false};let youtubeFails=true;const a=adapter();
  a.live=vi.fn(async (p:Platform)=>active[p]);a.output=vi.fn(async(p:Platform,start:boolean)=>{if(p==='youtube'&&youtubeFails)throw new Error('YouTube unavailable');active[p]=start;});
  const control=await ControlService.open(path.join(await temporary(),'control.json'),a,()=>{},async()=>{});
  const first=await control.execute(request('live.start'));expect(first.status).toBe('partial');expect(first.platforms?.twitch?.live).toBe(true);
  youtubeFails=false;const retry=await control.execute(request('live.start','command_retry','youtube'));expect(retry.status).toBe('succeeded');
  expect(vi.mocked(a.output).mock.calls.filter(([p])=>p==='twitch')).toHaveLength(1);
  expect(active).toEqual({twitch:true,youtube:true});
 });
 it('does not declare OBS dispatch a successful live without platform confirmation',async()=>{
  const a=adapter();const control=await ControlService.open(path.join(await temporary(),'control.json'),a,()=>{},async()=>{});
  const result=await control.execute(request('live.start'));expect(result.status).toBe('uncertain');expect(result.platforms?.youtube?.live).toBe(false);
 });
 it('rejects obsolete immediate actions and conflicting configuration writes',async()=>{
  const a=adapter(),control=await ControlService.open(path.join(await temporary(),'control.json'),a);
  await expect(control.execute({...request('micro'),issuedAt:new Date(Date.now()-60000).toISOString()})).rejects.toThrow('expirée');
  const config=control.snapshot().configuration;config.actions[0].label='Micro principal';await control.configure(config,0);
  await expect(control.configure(config,0)).rejects.toThrow('autre appareil');expect(a.action).not.toHaveBeenCalled();
 });
 it('retains desired metadata and per-platform results for targeted retry across restart',async()=>{
  const file=path.join(await temporary(),'control.json'),a=adapter();a.metadata=vi.fn(async p=>{if(p==='youtube')throw new Error('Quota');});
  let control=await ControlService.open(file,a);const metadata={...defaultControlData().configuration.metadata,title:'Le feu de camp',tags:['Francais']};
  const result=await control.execute({...request('metadata.apply'),metadata,expectedRevision:0});expect(result.status).toBe('partial');
  control=await ControlService.open(file,a);expect(control.snapshot().configuration.metadata.title).toBe(metadata.title);a.metadata=vi.fn(async()=>{});
  await control.execute(request('metadata.retry','command_retry','youtube'));expect(a.metadata).toHaveBeenCalledExactlyOnceWith('youtube',metadata);
 });
 it('keeps legacy paired devices limited and persists explicit management rights',()=>{
  const auth=new RemoteAuth();const old=auth.createPairing(),next=auth.createPairing(undefined,true);const a=auth.pair(old.id,old.code,'Old'),b=auth.pair(next.id,next.code,'S24');
  expect(auth.canManage(a.deviceId)).toBe(false);expect(auth.canManage(b.deviceId)).toBe(true);
  const reopened=new RemoteAuth(Date.now,auth.serialize());expect(reopened.canManage(b.deviceId)).toBe(true);reopened.revoke(b.deviceId);expect(reopened.canManage(b.deviceId)).toBe(false);
 });
});

describe('Real HTTP persistence and cross-client conflict handling',()=>{
 it('creates, updates and deletes events, rejects stale edits, and retains shared configuration after restart',async()=>{
  const dataDir=await temporary();const options={port:0,dataDir,logger:{info(){},warn(){},error(){}}};let server=await startDashboardServer(options);servers.push(server);
  const call=async(route:string,body?:unknown,method=body===undefined?'GET':'POST')=>{const response=await fetch(server.url+route,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};};
  let state=(await call('/api/v2/state')).body;
  const event={title:'Live de test local',startAtUtc:'2027-01-01T18:00:00Z',endAtUtc:'2027-01-01T20:00:00Z',category:'live',desiredPublication:{local:true,twitch:false,google:false}};
  expect((await call('/api/v2/planning',event)).status).toBe(201);
  state=(await call('/api/v2/state')).body;const item=state.host.planning[0],revision=state.host.planningRevisions[item.id];
  expect((await call('/api/v2/planning/'+item.id,{title:'Modifié depuis le téléphone',expectedRevision:revision},'PUT')).status).toBe(200);
  expect((await call('/api/v2/planning/'+item.id,{title:'Écriture obsolète desktop',expectedRevision:revision},'PUT')).status).toBe(409);
  expect((await call('/api/v2/settings',{expectedRevision:state.host.settingsRevision,streamerName:'Le Feu de Camp de Dam'},'PUT')).status).toBe(200);
  const configuration=state.configuration;configuration.actions[0].label='Micro personnalisé';expect((await call('/api/v2/configuration',{configuration,expectedRevision:0},'PUT')).status).toBe(200);
  await server.stop();servers.pop();server=await startDashboardServer(options);servers.push(server);
  state=(await call('/api/v2/state')).body;expect(state.host.settings.streamerName).toBe('Le Feu de Camp de Dam');expect(state.configuration.actions[0].label).toBe('Micro personnalisé');expect(state.host.planning[0].title).toBe('Modifié depuis le téléphone');
  expect((await call('/api/v2/planning/'+item.id,{expectedRevision:state.host.planningRevisions[item.id]},'DELETE')).status).toBe(200);expect((await call('/api/v2/state')).body.host.planning).toHaveLength(0);
 },20000);
});
