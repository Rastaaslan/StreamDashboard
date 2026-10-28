import type {AgentObservation} from '../../../packages/contracts/src/agent-v2.js';
import type {ObsHealth} from '../../agent/src/read-only-observer.js';
import type {ManagedControllerPeer} from '../../agent/src/readonly-network-config.js';
import {readOnlyDeadline,waitReadOnly} from '../../agent/src/managed-readonly-runtime.js';
import {readPinnedAgentHealth} from './read-only-gateway-client.js';

export interface ControllerAgentStatus {
  status:'not_configured'|'connecting'|'connected'|'unavailable'|'stopped';
  sourceDeviceId?:string;
  observation:AgentObservation<ObsHealth>|null;
}
export class ControllerAgentLink {
  private readonly controller=new AbortController();
  private worker?:Promise<void>;
  private current:ControllerAgentStatus={status:'not_configured',observation:null};
  constructor(private readonly load:()=>Promise<ManagedControllerPeer|undefined>,
    private readonly request=readPinnedAgentHealth,
    private readonly sleep=waitReadOnly,private readonly now=Date.now){}
  start():void {
    if(this.worker||this.controller.signal.aborted)return;
    this.worker=this.run();
  }
  snapshot():ControllerAgentStatus {
    const value=this.current;
    if(value.observation&&this.now()>=value.observation.staleAt)
      return {status:'unavailable',sourceDeviceId:value.sourceDeviceId,observation:null};
    return structuredClone(value);
  }
  private async run():Promise<void>{
    const signal=this.controller.signal;
    let failures=0;
    try{
      while(!signal.aborted){
        let peer:ManagedControllerPeer|undefined,abandoned=false;
        try{
          const loading=this.load().then(value=>{
            if(abandoned||signal.aborted){value?.dispose();throw Error('CONTROLLER_AGENT_STOPPED')}
            return value;
          });
          peer=await readOnlyDeadline(loading,10000,signal);
          if(!peer){this.current={status:'not_configured',observation:null};await this.sleep(5000,signal);continue}
          this.current={status:'connecting',sourceDeviceId:peer.expectedDeviceId,observation:null};
          while(!signal.aborted){
            const observation=await readOnlyDeadline(this.request({...peer,signal},this.now()),5000,signal);
            if(signal.aborted)break;
            this.current={status:'connected',sourceDeviceId:peer.expectedDeviceId,observation};
            failures=0;await this.sleep(2500,signal);
          }
        }catch{
          if(!signal.aborted)this.current={status:'unavailable',
            sourceDeviceId:peer?.expectedDeviceId,observation:null};
        }finally{abandoned=true;peer?.dispose()}
        if(signal.aborted)break;
        await this.sleep(Math.min(500*2**Math.min(failures++,4),5000),signal);
      }
    }finally{this.current={status:'stopped',observation:null}}
  }
  async stop():Promise<void>{
    this.controller.abort();
    await this.worker;
    this.current={status:'stopped',observation:null};
  }
}
