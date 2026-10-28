import OBSWebSocket from 'obs-websocket-js/json';
import {readOnlyDeadline} from './managed-readonly-runtime.js';

/** Simulation transport only. A real OBS has no matching fake-peer attestation.
 * This marker is a laboratory interlock, not production authentication.
 * No password, DNS name, network interface or service discovery is accepted.
 */
export const fakeObsWriterOptIn='I_ACCEPT_FAKE_OBS_WRITER_ONLY' as const;
export interface FakeObsEndpoint {
  optIn:typeof fakeObsWriterOptIn;
  url:string;
  simulationToken:string;
  timeoutMs?:number;
}
export function checkedFakeObsEndpoint(options:FakeObsEndpoint):string {
  let url:URL;
  try{url=new URL(options.url)}catch{throw Error('FAKE_OBS_ENDPOINT_REQUIRED')}
  if(options.optIn!==fakeObsWriterOptIn||url.protocol!=='ws:'||
    url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash||
    !/^[a-f0-9]{64}$/.test(options.simulationToken)||
    url.pathname!=='/sd-fake-obs/'+options.simulationToken||
    !url.port||Number(url.port)<1024||Number(url.port)===4455||
    !Number.isSafeInteger(options.timeoutMs??1000)||
    (options.timeoutMs??1000)<10||(options.timeoutMs??1000)>5000)
    throw Error('FAKE_OBS_ENDPOINT_REQUIRED');
  return url.href;
}
export class FakeObsConnection {
  private constructor(private readonly client:OBSWebSocket,
    private readonly timeoutMs:number,private readonly signal:AbortSignal) {}
  private async bounded<T>(work:Promise<T>):Promise<T>{
    return readOnlyDeadline(work,this.timeoutMs,this.signal);
  }
  static async open(options:FakeObsEndpoint,signal:AbortSignal):Promise<FakeObsConnection>{
    const url=checkedFakeObsEndpoint(options),client=new OBSWebSocket();
    const connection=new FakeObsConnection(client,options.timeoutMs??1000,signal);
    try{
      signal.throwIfAborted();
      const hello=await connection.bounded(client.connect(url,undefined,{eventSubscriptions:0}));
      if(hello.obsWebSocketVersion!=='SD_FAKE_OBS_SIMULATION_V1')
        throw Error('FAKE_OBS_ATTESTATION_REQUIRED');
      const version=await connection.bounded(client.call('GetVersion')) as unknown;
      if(!version||typeof version!=='object'||
        (version as Record<string,unknown>).simulationToken!==options.simulationToken)
        throw Error('FAKE_OBS_ATTESTATION_REQUIRED');
      return connection;
    }catch{
      await connection.close().catch(()=>{});
      throw Error('FAKE_OBS_CONNECTION_REFUSED');
    }
  }
  async read():Promise<boolean>{
    this.signal.throwIfAborted();
    const result=await this.bounded(this.client.call('GetStreamStatus'));
    if(typeof result?.outputActive!=='boolean')throw Error('FAKE_OBS_STATUS_INVALID');
    return result.outputActive;
  }
  async write(kind:'StartStream'|'StopStream'):Promise<void>{
    if(kind!=='StartStream'&&kind!=='StopStream')throw Error('SIMULATION_CAPABILITY_UNSUPPORTED');
    this.signal.throwIfAborted();
    await this.bounded(this.client.call(kind));
  }
  async close():Promise<void>{
    // A closed socket cannot establish whether a dispatched request took effect.
    // Its durable uncertain reservation is never changed by disconnect().
    const signal=new AbortController();
    await readOnlyDeadline(this.client.disconnect(),1000,signal.signal);
  }
}
