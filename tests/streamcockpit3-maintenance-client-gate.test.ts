import {expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startDashboardServer,type DashboardServerHandle} from '../apps/server/src/index.js';
import {MemorySecretStore} from '../apps/server/src/storage.js';
import {ObsClient} from '../integrations/obs/src/client.js';
import {TwitchClient} from '../integrations/twitch/src/client.js';
import * as restart from '../apps/server/src/restart-safety.js';
import {ControlService} from '../apps/server/src/control-service.js';

it.each(['idle','live','provider-unknown','control','changed-generation'] as const)(
 'actual isolated HTTP maintenance gate is read-only and requires fresh master and provider evidence: %s',async mode=>{
 const root=await mkdtemp(join(tmpdir(),'sc3-maintenance-client-gate-'));
 let server:DashboardServerHandle|undefined,instance:ObsClient|undefined;
 const configure=vi.spyOn(ObsClient.prototype,'configure').mockImplementation(async function(this:ObsClient){
  instance=this;Object.assign(this.state,{connected:true,streamingKnown:true,streaming:false,recording:false});return this.state;
 });
 const safety=vi.spyOn(restart,'assessRestartSafety').mockResolvedValue({safe:true});
 const provider=vi.spyOn(TwitchClient.prototype,'getLiveState').mockImplementation(async()=>{
  if(mode==='provider-unknown')throw Error('TEST_ONLY_PROVIDER_UNAVAILABLE');
  if(mode==='changed-generation'&&instance)Object.assign(instance.state,{connected:false});
  return {isLive:mode==='live'} as any;
 });
 const execute=vi.spyOn(ControlService.prototype,'execute');
 vi.stubEnv('DATA_FILE',join(root,'dashboard.json'));
 try{
  server=await startDashboardServer({dataDir:root,port:0,host:'127.0.0.1',obsEnabled:mode!=='control',timerAuthority:mode!=='control',
   remoteEnabled:false,secretStore:new MemorySecretStore(),twitchClientId:'',googleClientId:'',logger:{info:vi.fn(),warn:vi.fn(),error:vi.fn()}});
  await server.providersReady;
  const response=await fetch(server.url+'/api/v1/maintenance/safety');
  expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
  const result=await response.json();
  expect(result).toMatchObject({authority:mode==='control'?'control':'fixe',safe:mode==='idle'});
  expect(Number.isSafeInteger(result.observedAt)).toBe(true);
  expect(execute).not.toHaveBeenCalled();expect(JSON.stringify(result)).not.toContain('TEST_ONLY');
  if(mode==='control'){expect(configure).not.toHaveBeenCalled();expect(safety).not.toHaveBeenCalled();expect(provider).not.toHaveBeenCalled()}
 }finally{await server?.stop().catch(()=>undefined);vi.restoreAllMocks();vi.unstubAllEnvs();await rm(root,{recursive:true,force:true})}
},15000);
