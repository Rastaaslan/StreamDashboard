/** Display-only clock calibration from a freshly authenticated FIXE bundle.
 * This is not a timer engine, authority lease, local cache or command queue.
 * A skewed Android/Windows wall clock must not affect the master's deadline.
 */
const MAX_SAMPLE_AGE_MS=15_000;

export function sampleMasterClock(serverAt,receivedAt,endpoint){
  if(!Number.isSafeInteger(serverAt)||serverAt<=0||
    !Number.isFinite(receivedAt)||receivedAt<0||
    typeof endpoint!=='string'||!endpoint)return null;
  return {serverAt,receivedAt,endpoint};
}

/** Monotonic elapsed time since the last verified server snapshot. */
export function estimateMasterNow(sample,receivedAt,endpoint){
  if(!sample||sample.endpoint!==endpoint||!Number.isFinite(receivedAt))return null;
  const age=receivedAt-sample.receivedAt;
  if(age<0||age>MAX_SAMPLE_AGE_MS)return null;
  const value=sample.serverAt+age;
  return Number.isFinite(value)?value:null;
}

/** Authoritative display projection only. A running timer with no fresh
 * host-clock observation is UNKNOWN, never reconstructed from Date.now().
 * On disconnect a last-known remaining value can be shown as frozen/stale,
 * but cannot advance or initiate a command.
 */
export function masterTimerSeconds(timer,sample,receivedAt,endpoint,online){
  if(!timer||typeof timer!=='object')return null;
  if(!online||timer.running!==true){
    return Number.isFinite(timer.remaining)&&timer.remaining>=0?
      timer.remaining:null;
  }
  if(!Number.isSafeInteger(timer.deadline)||timer.deadline<=0)return null;
  const now=estimateMasterNow(sample,receivedAt,endpoint);
  return now===null?null:Math.max(0,(timer.deadline-now)/1000);
}

/** A visibility or pairing transition invalidates the whole observation,
 * including a suspended mobile browser's monotonic elapsed time. A fresh
 * authenticated FIXE snapshot is required to resume a running projection.
 * No local timer, persistence, retry, interval or independent clock owner.
 */
export function createMasterClockProjection(){
  let sample=null,revision=0;
  const observe=(serverAt,receivedAt,endpoint)=>{
    const fresh=sampleMasterClock(serverAt,receivedAt,endpoint);
    if(!fresh){sample=null;revision++;return false;}
    // Two overlapping GETs must not let a late, older observation replace
    // the latest FIXE timestamp after its fresher response arrived.
    if(sample&&sample.endpoint===endpoint){
      if(receivedAt<sample.receivedAt)return false;
      if(serverAt<sample.serverAt){
        // A delayed older reply or an unexpected FIXE clock rollback makes
        // the display uncertain until another authenticated observation.
        sample=null;
        revision++; // Revoke every older in-flight HTTP ticket, not just the sample.
        return false;
      }
    }
    sample=fresh;
    return true;
  };
  return Object.freeze({
    revision(){return revision;},
    observe,
    observeIfCurrent(ticket,serverAt,receivedAt,endpoint){
      if(!Number.isSafeInteger(ticket)||ticket!==revision)return false;
      return observe(serverAt,receivedAt,endpoint);
    },
    invalidate(){sample=null;revision++;},
    now(receivedAt,endpoint){return estimateMasterNow(sample,receivedAt,endpoint);},
    seconds(timer,receivedAt,endpoint,online){
      return masterTimerSeconds(timer,sample,receivedAt,endpoint,online);
    },
  });
}
