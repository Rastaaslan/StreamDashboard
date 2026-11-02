import {waitReadOnly} from './managed-readonly-runtime.js';

export interface ObsAuthorityMonitorOptions {
  writer:{refresh():Promise<unknown>};
  signal:AbortSignal;
  unavailable():void;
  pollMs?:number;
  sleep?:(milliseconds:number,signal:AbortSignal)=>Promise<void>;
}
/** Refreshes observations only. A lost authority is never reopened, and a busy
 * executor is never queued or retried as an OBS command. */
export async function runObsAuthorityMonitor(options:ObsAuthorityMonitorOptions):Promise<void>{
  const poll=options.pollMs??1500,sleep=options.sleep??waitReadOnly;
  if(!Number.isSafeInteger(poll)||poll<10||poll>2000)
    throw Error('INVALID_OBS_AUTHORITY_POLL');
  while(!options.signal.aborted){
    try{await options.writer.refresh()}
    catch(error){
      if(options.signal.aborted)return;
      if(!(error instanceof Error)||error.message!=='REAL_OBS_WRITER_BUSY'){
        options.unavailable();return;
      }
    }
    if(!options.signal.aborted)await sleep(poll,options.signal);
  }
}
