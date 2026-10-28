import type {AgentObservation} from '../../../packages/contracts/src/agent-v2.js';
import {observationFreshness} from '../../../packages/contracts/src/agent-v2.js';
import type {ObsHealth} from './read-only-observer.js';

const validId=(value:unknown):value is string=>
  typeof value==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(value);
const finiteMetric=(v:unknown):v is number|null=>
  v===null || typeof v==='number'&&Number.isFinite(v)&&v>=0;

/** Snapshot-only boundary between an OBS reader and the HTTPS Agent gateway.
 * Neither a failed OBS read nor a disconnected Controller may promote a stale
 * or invented status to 'connected'. The gateway owns no OBS write capability.
 */
export class AgentHealthSnapshotCache {
  private current:AgentObservation<ObsHealth>|null=null;
  private greatestRevision=-1;
  constructor(private readonly deviceId:string) {
    if(!validId(deviceId))throw Error('INVALID_OBSERVER_ID');
  }
  accept(value:AgentObservation<ObsHealth>,now:number):void {
    if(value.sourceDeviceId!==this.deviceId ||
       !Number.isFinite(now) ||
       observationFreshness(value,now)!=='fresh' ||
       value.staleAt-now>8000 ||
       !value.payload || value.payload.connected!==true ||
       typeof value.payload.active!=='boolean' ||
       !finiteMetric(value.payload.outputBytes) ||
       !finiteMetric(value.payload.skippedFrames) ||
       !finiteMetric(value.payload.renderedFrames))
      throw Error('INVALID_AGENT_HEALTH');
    if(value.revision<=this.greatestRevision)
      throw Error('OUT_OF_ORDER_AGENT_HEALTH');
    const snapshot=structuredClone(value);
    this.greatestRevision=value.revision;
    this.current=snapshot;
  }
  invalidate():void {
    this.current=null;
  }
  read(now:number):AgentObservation<ObsHealth>|null {
    if(!this.current ||
       observationFreshness(this.current,now)!=='fresh') return null;
    return structuredClone(this.current);
  }
}
