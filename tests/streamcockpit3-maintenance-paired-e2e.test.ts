import {expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {X509Certificate} from 'node:crypto';
import {startDashboardServer,type DashboardServerHandle} from '../apps/server/src/index.js';
import {MemorySecretStore} from '../apps/server/src/storage.js';
import {ObsClient} from '../integrations/obs/src/client.js';
import {TwitchClient} from '../integrations/twitch/src/client.js';
import * as restart from '../apps/server/src/restart-safety.js';
import {ControlService} from '../apps/server/src/control-service.js';
import {createPeerMaintenanceObserver} from '../apps/desktop/src/streamcockpit-peer-maintenance-observer.js';
import {isRemoteApiAllowed,isManagementApiAllowed,requiredDevicePermissions} from '../apps/server/src/remote-api-policy.js';

it('exposes only an authenticated observe GET for the native update gate; no restart/install verb is admitted',()=>{
 expect(isRemoteApiAllowed('GET','/v1/maintenance/safety')).toBe(true);
 expect(isManagementApiAllowed('GET','/v1/maintenance/safety')).toBe(true);
 expect(requiredDevicePermissions('GET','/v1/maintenance/safety',{})).toEqual(['observe']);
 for(const method of ['HEAD','POST','PUT','PATCH','DELETE']){
  expect(isRemoteApiAllowed(method,'/v1/maintenance/safety')).toBe(false);
  expect(isManagementApiAllowed(method,'/v1/maintenance/safety')).toBe(false);
 }
});
it.each([false,true])('an actual paired observe client reaches the actual temporary HTTPS safety endpoint through the native pinned observer (management=%s)',async management=>{
 const root=await mkdtemp(join(tmpdir(),'sc3-paired-maintenance-'));
 let server:DashboardServerHandle|undefined,reader:ReturnType<typeof createPeerMaintenanceObserver>|undefined;
 vi.stubEnv('DATA_FILE',join(root,'dashboard.json'));vi.stubEnv('STREAMLABS_SOCKET_TOKEN','');vi.stubEnv('DISCORD_BOT_TOKEN','');
 vi.spyOn(ObsClient.prototype,'configure').mockImplementation(async function(this:ObsClient){
  Object.assign(this.state,{connected:true,streamingKnown:true,streaming:false,recording:false});return this.state;
 });
 vi.spyOn(restart,'assessRestartSafety').mockResolvedValue({safe:true});
 vi.spyOn(TwitchClient.prototype,'getLiveState').mockResolvedValue({isLive:false} as any);
 const execute=vi.spyOn(ControlService.prototype,'execute');
 try{
  const [pfx,certificate]=await Promise.all([readFile('tests/fixtures/tls/agent.p12'),readFile('tests/fixtures/tls/agent.pem','utf8')]);
  server=await startDashboardServer({dataDir:root,port:0,host:'127.0.0.1',obsEnabled:true,timerAuthority:true,remoteEnabled:true,
   remoteTls:{pfx,certificate,passphrase:'test-only',port:0},
   secretStore:new MemorySecretStore(),twitchClientId:'',googleClientId:'',logger:{info:vi.fn(),warn:vi.fn(),error:vi.fn()}});
  await server.providersReady;
  const offer=await fetch(server.url+'/api/v1/remote/pairing',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({management,permissions:['observe']})});
  expect(offer.status).toBe(201);const enrollment=await offer.json();
  const response=await fetch(server.url+'/api/v1/remote/pair',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({id:enrollment.id,code:enrollment.code,name:'QA observe client'})});
  expect(response.status).toBe(201);const paired=await response.json();
  expect(server.remotePort).toBeGreaterThan(0);
  const peer={origin:'https://127.0.0.1:'+server.remotePort,credential:paired.credential,
   fingerprint:new X509Certificate(certificate).fingerprint256.replaceAll(':','').toLowerCase()};
  reader=createPeerMaintenanceObserver({peer});
  expect(await reader.observe()).toMatchObject({authority:'fixe-independent',obs:'idle',twitch:'offline'});
  await reader.close();
  reader=createPeerMaintenanceObserver({peer:{...peer,credential:'TEST_ONLY_INVALID_CREDENTIAL'}});
  expect(await reader.observe()).toBeUndefined();
  expect(execute).not.toHaveBeenCalled();
 }finally{await reader?.close();await server?.stop().catch(()=>undefined);vi.restoreAllMocks();vi.unstubAllEnvs();await rm(root,{recursive:true,force:true})}
},20000);
