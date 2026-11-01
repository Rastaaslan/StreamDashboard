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
