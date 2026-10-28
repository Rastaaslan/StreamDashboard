import type {Server as HttpsServer} from 'node:https';
import type {AgentObservation} from '../../../packages/contracts/src/agent-v2.js';
import type {ObsHealth,ObsReadOnlyClient} from './read-only-observer.js';
import {runReadOnlyAgent} from './read-only-runner.js';
import {AgentHealthSnapshotCache} from './health-snapshot-cache.js';
import {listenReadOnlyOnApprovedInterface,
  type ReadOnlyLabBinding,type ReadOnlyGatewayConfig} from './readonly-gateway.js';

export interface ReadOnlyBridgeLabConfig
  extends Pick<ReadOnlyGatewayConfig,
    'serverKey'|'serverCertificate'|'authorizedClientFingerprint'> {
  deviceId:string;
  client:ObsReadOnlyClient;
  binding:ReadOnlyLabBinding;
  pollMs?:number;
}
export interface ReadOnlyBridgeLabSession {
  server:HttpsServer;
  stop():Promise<void>;
}
/** No production entrypoint calls this constructor. It is a read-only, opt-in
 * test harness joining OBS polling to the certificate-pinned gateway.
 * It has no OBS start/stop, no command executor, and no persistent secrets.
 */
export async function startReadOnlyBridgeLab(
  config:ReadOnlyBridgeLabConfig,
):Promise<ReadOnlyBridgeLabSession> {
  const interval=config.pollMs??5000;
  if(!Number.isSafeInteger(interval)||interval<100||interval>5000)
    throw Error('INVALID_LAB_POLL_INTERVAL');
  const cache=new AgentHealthSnapshotCache(config.deviceId);
  const signal=new AbortController();
  const server=await listenReadOnlyOnApprovedInterface({
    serverKey:config.serverKey,serverCertificate:config.serverCertificate,
    authorizedClientFingerprint:config.authorizedClientFingerprint,
    now:Date.now,snapshot:()=>cache.read(Date.now()),
  },config.binding);
  let stopped=false;
  const waiter=(ms:number,abort:AbortSignal)=>new Promise<void>(resolve=>{
    if(abort.aborted){resolve();return}
    const timer=setTimeout(()=>{abort.removeEventListener('abort',end);resolve()},ms);
    function end(){clearTimeout(timer);resolve()}
    abort.addEventListener('abort',end,{once:true});
  });
  const worker=runReadOnlyAgent({
    client:config.client,deviceId:config.deviceId,now:Date.now,
    signal:signal.signal,
    sleep:(_ms,abort)=>waiter(interval,abort),
    emit:(status:AgentObservation<ObsHealth>)=>cache.accept(status,Date.now()),
    reportUnreachable:()=>cache.invalidate(),
  }).catch(()=>{
    cache.invalidate();signal.abort();
  });
  server.once('close',()=>{cache.invalidate();signal.abort()});
  server.on('error',()=>{cache.invalidate();signal.abort()});
  return {server,async stop(){
    if(stopped)return;
    stopped=true;
    signal.abort();cache.invalidate();
    await worker;
    if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
  }};
}
