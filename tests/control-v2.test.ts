import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
 it('migrates stock M5 once, backs up RC4 and preserves custom associations and removed presets',async()=>{
  const file=path.join(await temporary(),'control.json'),old=defaultControlData();delete old.featureVersion;
  old.configuration.actions=old.configuration.actions.slice(0,6);
  old.configuration.actions[4]={id:'sound-stop',label:'Arrêter le son',type:'sound.stop',value:'',color:'red',shortcut:'Control+Alt+Shift+F5'};
  old.configuration.actions[0].shortcut='Control+Alt+Shift+F12';
  await writeFile(file,JSON.stringify(old));let control=await ControlService.open(file,adapter());
  expect(control.snapshot().configuration.actions[4].type).toBe('replay.save');expect(control.snapshot().configuration.revision).toBe(1);expect(JSON.parse(await readFile(file+'.pre-rc5','utf8'))).toEqual(old);
  expect(control.snapshot().configuration.actions[0].shortcut).toBe('Control+Alt+Shift+F12');
  const c=control.snapshot().configuration;c.actions=c.actions.filter(a=>a.type!=='wizebot.command');await control.configure(c,c.revision);await control.stop();
  control=await ControlService.open(file,adapter());expect(control.snapshot().configuration.actions.some(a=>a.type==='wizebot.command')).toBe(false);await control.stop();
  old.configuration.actions[4].label='Mon bouton';await writeFile(file,JSON.stringify(old));control=await ControlService.open(file,adapter());expect(control.snapshot().configuration.actions[4].type).toBe('sound.stop');
 });
 it('persists a confirmed clip path and uncertain saves without repeating them after restart',async()=>{
  const file=path.join(await temporary(),'control.json'),a=adapter();a.action=vi.fn(async()=>({message:'Clip sauvegardé',replayPath:'C:/Videos/replay.mkv'}));
  let control=await ControlService.open(file,a);const r=await control.execute(request('clip-save'));
  expect(r).toMatchObject({status:'succeeded',result:{replayPath:'C:/Videos/replay.mkv'}});await control.stop();control=await ControlService.open(file,a);await control.execute(request('clip-save'));expect(a.action).toHaveBeenCalledTimes(1);
  a.action=vi.fn(async()=>{throw Object.assign(new Error('Vérifiez les clips'),{name:'ACTION_UNCERTAIN'});});expect(await control.execute(request('clip-save','uncertain_clip'))).toMatchObject({status:'uncertain'});await control.execute(request('clip-save','uncertain_clip'));expect(a.action).toHaveBeenCalledTimes(1);
 });
 it('validates single-line WizeBot commands and journals their delivery result once',async()=>{
  const a=adapter(),control=await ControlService.open(path.join(await temporary(),'control.json'),a);let c=control.snapshot().configuration;
  const w=c.actions.find(a=>a.id==='wizebot-uptime')!;w.value='!uptime\n!ban someone';await expect(control.configure(c,0)).rejects.toThrow('une seule ligne');
  c=control.snapshot().configuration;c.actions.find(a=>a.id==='wizebot-uptime')!.value='!discord';await control.configure(c,0);
  a.action=vi.fn(async()=>({message:'Envoyé dans Twitch, réponse non confirmée',messageId:'message_1'}));
  expect(await control.execute(request('wizebot-uptime'))).toMatchObject({status:'succeeded',result:{messageId:'message_1'}});await control.execute(request('wizebot-uptime'));expect(a.action).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({value:'!discord',type:'wizebot.command'}),'command_123456');
 });
 it('journals catalogue playback by sound identity and reports a failed stop honestly',async()=>{
  const a=adapter(),control=await ControlService.open(path.join(await temporary(),'control.json'),a);
  const play={...request('sound.play'),soundId:'bonk'};
  expect((await control.execute(play)).status).toBe('succeeded');await control.execute(play);
  await expect(control.execute({...play,soundId:'airhorn'})).rejects.toThrow('Identifiant');
  await control.execute({...request('sound.play','another_sound'),soundId:'airhorn'});
  expect(vi.mocked(a.action).mock.calls.map(([action])=>action.value)).toEqual(['bonk','airhorn']);
  a.action=vi.fn(async()=>{throw new Error('OBS déconnecté');});
  expect(await control.execute(request('sound.stop','stop_failed_1'))).toMatchObject({status:'failed',message:'OBS déconnecté'});
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

it('rejects a stale action definition inside the serialized executor before any effect',async()=>{
 const a=adapter(),control=await ControlService.open(path.join(await temporary(),'control.json'),a);
 const original=control.snapshot().configuration.actions[0], config=control.snapshot().configuration;
 config.actions[0].value='new-microphone';await control.configure(config,config.revision);
 const result=await control.execute({...request(original.id,'stale_binding_1'),expectedAction:original});
 expect(result.status).toBe('failed');expect(a.action).not.toHaveBeenCalled();
 const confirmed=await control.execute({...request(original.id,'valid_binding_1'),expectedAction:config.actions[0]});
 expect(confirmed.status).toBe('succeeded');expect(a.action).toHaveBeenCalledTimes(1);
});

it('rechecks an executor permission inside the command queue, before an action effect',async()=>{
 const a=adapter(),control=await ControlService.open(path.join(await temporary(),'control.json'),a);
 const result=await control.execute(request('micro','permission_queue'),()=>{throw Error('Permission revoked');});
 expect(result.status).toBe('failed');expect(result.message).toContain('Permission revoked');expect(a.action).not.toHaveBeenCalled();
});
