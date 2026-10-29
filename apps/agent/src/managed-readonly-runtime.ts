import {observeObsHealth,type ObsHealth,type ObsReadOnlyClient} from './read-only-observer.js';
import type {AgentObservation} from '../../../packages/contracts/src/agent-v2.js';

export function waitReadOnly(milliseconds:number,signal:AbortSignal):Promise<void> {
  if(signal.aborted)return Promise.resolve();
  return new Promise(resolve=>{
    const end=()=>{clearTimeout(timer);signal.removeEventListener('abort',end);resolve()};
    const timer=setTimeout(end,milliseconds);
    signal.addEventListener('abort',end,{once:true});
    if(signal.aborted)end();
  });
}
export async function readOnlyDeadline<T>(work:Promise<T>,milliseconds:number,signal:AbortSignal):Promise<T> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  let cancel:(()=>void)|undefined;
  try{
    return await Promise.race([work,new Promise<never>((_,reject)=>{
      cancel=()=>reject(Error('READ_ONLY_CANCELLED'));
      signal.addEventListener('abort',cancel,{once:true});
      timer=setTimeout(()=>reject(Error('READ_ONLY_TIMEOUT')),milliseconds);
      if(signal.aborted)cancel();
    })]);
  }finally{if(timer)clearTimeout(timer);if(cancel)signal.removeEventListener('abort',cancel)}
}
export interface ReadOnlyConnection extends ObsReadOnlyClient {
  disconnected?:AbortSignal;
  close():Promise<void>;
}
export interface ManagedReadOnlyOptions {
  deviceId:string;
  signal:AbortSignal;
  connect(signal:AbortSignal):Promise<ReadOnlyConnection>;
  emit(snapshot:AgentObservation<ObsHealth>):void;
  unavailable():void;
  state?(state:'connecting'|'observing'|'unavailable'|'stopped'):void;
  now?():number;
  sleep?(milliseconds:number,signal:AbortSignal):Promise<void>;
  pollMs?:number;
  connectTimeoutMs?:number;
  readTimeoutMs?:number;
}
async function closeConnection(connection:ReadOnlyConnection):Promise<void>{
  const controller=new AbortController();
  try{await readOnlyDeadline(Promise.resolve().then(()=>connection.close()),1000,controller.signal)}catch{}
}
/** One monitor owns connection/reconnect/shutdown. It never queues an OBS write.
 * A failed read immediately invalidates health. Reconnection does not recycle a
 * revision or publish an abandoned late connection/read as a fresh observation.
 */
export async function runManagedReadOnlyAgent(options:ManagedReadOnlyOptions):Promise<void>{
  const poll=options.pollMs??5000,connectTimeout=options.connectTimeoutMs??6000;
  const readTimeout=options.readTimeoutMs??3000,now=options.now??Date.now;
  const sleep=options.sleep??waitReadOnly;
  if(!Number.isSafeInteger(poll)||poll<10||poll>5000||
     !Number.isSafeInteger(connectTimeout)||connectTimeout<10||connectTimeout>10000||
     !Number.isSafeInteger(readTimeout)||readTimeout<10||readTimeout>10000)
    throw Error('INVALID_MANAGED_READ_ONLY_TIMING');
  let revision=0,failures=0;
  try{
    while(!options.signal.aborted){
      const attempt=new AbortController();
      const active=AbortSignal.any([options.signal,attempt.signal]);
      let connection:ReadOnlyConnection|undefined,abandoned=false;
      try{
        options.state?.('connecting');
        const connecting=Promise.resolve().then(()=>options.connect(active)).then(value=>{
          if(abandoned||active.aborted){void closeConnection(value);throw Error('READ_ONLY_CANCELLED')}
          return value;
        });
        connection=await readOnlyDeadline(connecting,connectTimeout,active);
        const session=connection.disconnected?
          AbortSignal.any([active,connection.disconnected]):active;
        const lost=()=>options.unavailable();
        session.addEventListener('abort',lost,{once:true});
        try{
          while(!session.aborted){
            const snapshot=await readOnlyDeadline(
              observeObsHealth(connection,options.deviceId,++revision,now()),readTimeout,session);
            if(session.aborted)break;
            options.emit(snapshot);options.state?.('observing');failures=0;
            await sleep(poll,session);
          }
        }finally{session.removeEventListener('abort',lost)}
      }catch{if(!options.signal.aborted)options.state?.('unavailable')}
      finally{
        abandoned=true;attempt.abort();options.unavailable();
        if(connection)await closeConnection(connection);
      }
      if(options.signal.aborted)break;
      await sleep(Math.min(500*2**Math.min(failures++,4),5000),options.signal);
    }
  }finally{options.unavailable();options.state?.('stopped')}
}
