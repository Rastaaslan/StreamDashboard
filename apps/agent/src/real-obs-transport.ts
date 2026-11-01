import OBSWebSocket from 'obs-websocket-js';
import {readOnlyDeadline} from './managed-readonly-runtime.js';

export const realObsWriterOptIn='I_ACCEPT_REAL_OBS_WRITES' as const;
export interface RealObsEndpoint {
  optIn:typeof realObsWriterOptIn;
  url:string;
  password:string;
  timeoutMs?:number;
}
/** The production writer may talk only to the authenticated OBS process on the
 * same PC. It never accepts a network destination supplied by an HTTP client. */
export function checkedRealObsEndpoint(options:RealObsEndpoint):string {
  let url:URL;
  try{url=new URL(options.url)}catch{throw Error('REAL_OBS_ENDPOINT_REFUSED')}
  const timeout=options.timeoutMs??4000;
  if(options.optIn!==realObsWriterOptIn||url.protocol!=='ws:'||
     url.hostname!=='127.0.0.1'||!url.port||Number(url.port)<1024||Number(url.port)>65535||
     url.username||url.password||url.pathname!=='/'||url.search||url.hash||
     typeof options.password!=='string'||options.password.length<1||options.password.length>65536||
     !Number.isSafeInteger(timeout)||timeout<100||timeout>10000)
    throw Error('REAL_OBS_ENDPOINT_REFUSED');
  return url.origin;
}
export type RealObsClient=Pick<OBSWebSocket,'connect'|'call'|'disconnect'|'once'|'off'>;
export class RealObsConnection {
  readonly disconnected=new AbortController();
  private constructor(private readonly client:RealObsClient,private readonly timeout:number,
    private readonly signal:AbortSignal,private readonly listener:()=>void){}
  private bounded<T>(promise:Promise<T>):Promise<T>{
    if(this.signal.aborted||this.disconnected.signal.aborted)throw Error('OBS_CONNECTION_LOST');
    return readOnlyDeadline(promise,this.timeout,AbortSignal.any([this.signal,this.disconnected.signal]));
  }
  static async open(options:RealObsEndpoint,signal:AbortSignal,
    factory:()=>RealObsClient=()=>new OBSWebSocket()):Promise<RealObsConnection>{
    const url=checkedRealObsEndpoint(options),client=factory(),lost=new AbortController();
    const onLost=()=>lost.abort();
    client.once('ConnectionClosed',onLost);
    const connection=new RealObsConnection(client,options.timeoutMs??4000,signal,onLost);
    // Reuse the connection-owned abort controller so a lost socket fences writes.
    lost.signal.addEventListener('abort',()=>connection.disconnected.abort(),{once:true});
    try{
      signal.throwIfAborted();
      await connection.bounded(client.connect(url,options.password,{eventSubscriptions:0}));
      if(signal.aborted||connection.disconnected.signal.aborted)throw Error('OBS_CONNECTION_LOST');
      await connection.read();
      return connection;
    }catch{
      await connection.close().catch(()=>{});
      throw Error('REAL_OBS_CONNECTION_REFUSED');
    }
  }
  async read():Promise<boolean>{
    const result=await this.bounded(this.client.call('GetStreamStatus'));
    if(typeof result?.outputActive!=='boolean')throw Error('REAL_OBS_STATUS_INVALID');
    return result.outputActive;
  }
  async readScene():Promise<string>{
    const result=await this.bounded(this.client.call('GetCurrentProgramScene'));
    if(typeof result?.currentProgramSceneName!=='string'||!result.currentProgramSceneName)
      throw Error('REAL_OBS_SCENE_INVALID');
    return result.currentProgramSceneName;
  }
  async sceneNames():Promise<string[]>{
    const result=await this.bounded(this.client.call('GetSceneList'));
    if(!Array.isArray(result?.scenes))throw Error('REAL_OBS_SCENES_INVALID');
    return result.scenes.map(value=>value.sceneName).filter((value):value is string=>typeof value==='string');
  }
  async writeScene(scene:string):Promise<void>{
    if(typeof scene!=='string'||!scene.trim()||scene.length>256||/[\x00-\x1f\x7f]/.test(scene))
      throw Error('INVALID_SCENE');
    await this.bounded(this.client.call('SetCurrentProgramScene',{sceneName:scene}));
  }
  async write(kind:'StartStream'|'StopStream'):Promise<void>{
    if(kind!=='StartStream'&&kind!=='StopStream')throw Error('REAL_OBS_WRITE_UNSUPPORTED');
    await this.bounded(this.client.call(kind));
  }
  async close():Promise<void>{
    this.disconnected.abort();
    this.client.off('ConnectionClosed',this.listener);
    const controller=new AbortController();
    await readOnlyDeadline(Promise.resolve().then(()=>this.client.disconnect()),1000,controller.signal).catch(()=>{});
  }
}
