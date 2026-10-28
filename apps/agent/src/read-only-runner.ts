import {observeObsHealth,type ObsHealth,type ObsReadOnlyClient} from './read-only-observer.js';
import type {AgentObservation} from '../../../packages/contracts/src/agent-v2.js';

/** Read-only OBS polling. A hung OBS request must never hold the service
 * shutdown hostage or permit an old late response to publish as healthy.
 */
export interface AgentReadOnlyRunnerOptions {
  client:ObsReadOnlyClient;
  deviceId:string;
  signal:AbortSignal;
  now():number;
  sleep(milliseconds:number,signal:AbortSignal):Promise<void>;
  emit(snapshot:AgentObservation<ObsHealth>):void;
  reportUnreachable(code:string):void;
  readTimeoutMs?:number;
}
export async function runReadOnlyAgent(options:AgentReadOnlyRunnerOptions):Promise<void> {
  const readTimeout=options.readTimeoutMs??3000;
  if(!Number.isSafeInteger(readTimeout)||readTimeout<100||readTimeout>10000)
    throw Error('INVALID_OBS_READ_TIMEOUT');
  let revision=0;
  while(!options.signal.aborted) {
    let timer:ReturnType<typeof setTimeout>|undefined;
    let abortListener:(()=>void)|undefined;
    try {
      const timed=new Promise<never>((_,reject)=>{
        abortListener=()=>reject(Error('OBS_READ_ABORTED'));
        options.signal.addEventListener('abort',abortListener,{once:true});
        timer=setTimeout(()=>reject(Error('OBS_READ_TIMEOUT')),readTimeout);
      });
      // Promise.race attaches rejection handlers to the abandoned read.
      // The late OBS response cannot reach emit() or renew freshness.
      const next=await Promise.race([
        observeObsHealth(options.client,options.deviceId,++revision,options.now()),
        timed,
      ]);
      if(options.signal.aborted)return;
      options.emit(next);
    }catch {
      if(options.signal.aborted)return;
      options.reportUnreachable('OBS_READ_UNAVAILABLE');
    }finally{
      if(timer)clearTimeout(timer);
      if(abortListener)options.signal.removeEventListener('abort',abortListener);
    }
    if(options.signal.aborted)return;
    await options.sleep(5000,options.signal);
  }
}
