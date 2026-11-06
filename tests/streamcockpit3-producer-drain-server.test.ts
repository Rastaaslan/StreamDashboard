import {expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startDashboardServer,type DashboardServerHandle} from '../apps/server/src/index.js';
import {MemorySecretStore} from '../apps/server/src/storage.js';
import {AutomationRuntime} from '../apps/server/src/automation-runtime.js';
import {ObsReplayMomentProducer} from '../apps/server/src/streamcockpit-moments-obs-replay.js';
import {StreamlabsMomentProducer} from '../apps/server/src/streamcockpit-moments-streamlabs.js';
import {ObsClient} from '../integrations/obs/src/client.js';
import {ControlService} from '../apps/server/src/control-service.js';

const deferred=()=>{
  let resolve!:()=>void,reject!:(error:Error)=>void;
  const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no});
  return {promise,resolve,reject};
};

it.each([false,true])('F10 actual isolated DashboardServer waits for all producers and finishes cleanup (uncertain=%s)',async uncertain=>{
  const root=await mkdtemp(join(tmpdir(),'sc3-producer-drain-'));
  const gates=[deferred(),deferred(),deferred()];
  const forbidden:string[]=[];let base='';
  const nativeFetch=globalThis.fetch;
  const network=vi.spyOn(globalThis,'fetch').mockImplementation((input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if(!base||!url.startsWith(base+'/')){forbidden.push(url);return Promise.reject(Error('External network forbidden in fixture'))}
    return nativeFetch(input,init);
  });
  vi.stubEnv('DATA_FILE',join(root,'dashboard.json'));
  const automationStop=AutomationRuntime.prototype.stop;
  const replayStop=ObsReplayMomentProducer.prototype.stop;
  const streamlabsStop=StreamlabsMomentProducer.prototype.stop;
  const automations=vi.spyOn(AutomationRuntime.prototype,'stop').mockImplementation(function(this:AutomationRuntime){
    return Promise.all([automationStop.call(this),gates[0]!.promise]).then(()=>undefined);
  });
  const replays=vi.spyOn(ObsReplayMomentProducer.prototype,'stop').mockImplementation(function(this:ObsReplayMomentProducer){
    return Promise.all([replayStop.call(this),gates[1]!.promise]).then(()=>undefined);
  });
  const streamlabs=vi.spyOn(StreamlabsMomentProducer.prototype,'stop').mockImplementation(function(this:StreamlabsMomentProducer){
    return Promise.all([streamlabsStop.call(this),gates[2]!.promise]).then(()=>undefined);
  });
  const obsConfigure=vi.spyOn(ObsClient.prototype,'configure');
  const obsClose=vi.spyOn(ObsClient.prototype,'close');
  const controlStop=vi.spyOn(ControlService.prototype,'stop');
  const logger={info:vi.fn(),warn:vi.fn(),error:vi.fn()};
  let server:DashboardServerHandle|undefined;
  let completion:Promise<{error?:unknown}>|undefined;
  try{
    server=await startDashboardServer({dataDir:root,port:0,host:'127.0.0.1',obsEnabled:false,timerAuthority:false,
      remoteEnabled:false,secretStore:new MemorySecretStore(),twitchClientId:'',googleClientId:'',logger});
    base=server.url;await server.providersReady;
    expect((await fetch(base+'/')).ok).toBe(true);
    expect(obsConfigure).not.toHaveBeenCalled();
    const stopping=server.stop();expect(server.stop()).toBe(stopping);
    let finished=false;
    completion=stopping.then(()=>{finished=true;return {}},error=>{finished=true;return {error}});
    expect(automations).toHaveBeenCalledTimes(1);expect(replays).toHaveBeenCalledTimes(1);
    expect(streamlabs).toHaveBeenCalledTimes(1);
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(finished).toBe(false);expect(controlStop).not.toHaveBeenCalled();
    if(uncertain)gates[1]!.reject(Error('Authorization: Bearer PRIVATE_FIXTURE'));
    else gates[1]!.resolve();
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(finished).toBe(false);expect(controlStop).not.toHaveBeenCalled();
    gates[0]!.resolve();gates[2]!.resolve();
    const result=await completion;
    if(uncertain){
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toBe('RUNTIME_PRODUCER_SHUTDOWN_UNCERTAIN');
    }else expect(result.error).toBeUndefined();
    expect(finished).toBe(true);expect(controlStop).toHaveBeenCalledTimes(1);expect(obsClose).toHaveBeenCalledTimes(1);
    expect(server.server.listening).toBe(false);
    expect(JSON.parse(await readFile(join(root,'dashboard.json'),'utf8'))).toHaveProperty('settings');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('PRIVATE_FIXTURE');
    expect(forbidden).toEqual([]);
  }finally{
    for(const gate of gates)gate.resolve();
    await completion;await server?.stop().catch(()=>undefined);
    network.mockRestore();vi.restoreAllMocks();vi.unstubAllEnvs();
    await rm(root,{recursive:true,force:true});
  }
},15000);
