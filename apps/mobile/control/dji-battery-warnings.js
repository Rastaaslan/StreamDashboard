/**
 * Stream-safe Mic 3 warning state machine.
 *
 * Only previously observed wireless TXs can be reported as disconnected.
 * Seven-stage DJI values are raw codes, not percentages. 6/7 and 7/7 prompt
 * a check on the receiver, NEVER a fabricated low-battery percentage.
 */
export const DJI_WARNING_COOLDOWN_MS = 5 * 60_000;
export const DJI_SENSOR_MAX_AGE_MS = 90_000;
export const DJI_SENSOR_LOST_GRACE_MS = 95_000;

function validPacket(relay, now) {
  if (!relay || relay.status !== 'ok' || relay.observation?.status !== 'ok') return null;
  const received = Date.parse(relay.receivedAt);
  const measured = Date.parse(relay.observation.observedAt);
  if (!Number.isFinite(received) || !Number.isFinite(measured)
    || received - now > 15_000 || measured - now > 15_000
    || now - received > DJI_SENSOR_MAX_AGE_MS
    || now - measured > DJI_SENSOR_MAX_AGE_MS
    || !Number.isInteger(relay.observation.validFrames)
    || relay.observation.validFrames < 1
    || !Array.isArray(relay.observation.tx)
    || relay.observation.tx.length !== 2) return null;
  return relay.observation;
}

export function createDjiBatteryWarningTracker({now = Date.now, cooldownMs = DJI_WARNING_COOLDOWN_MS} = {}) {
  let live = false, seenValid = false, lastFreshAt = 0, notifiedMissing = false;
  const previouslyConnected = new Set();
  const lastWarnings = new Map();
  function emit(warning, warnings) {
    const at = now();
    if (lastWarnings.has(warning.code) && at - lastWarnings.get(warning.code) < cooldownMs) return;
    lastWarnings.set(warning.code, at);
    warnings.push(warning);
  }
  function reset() {
    live = false;seenValid = false;lastFreshAt = 0;notifiedMissing = false;
    previouslyConnected.clear();lastWarnings.clear();
  }
  function check({streaming, relay}) {
    if (!streaming) { if (live) reset(); return []; }
    live = true;
    const warnings = [];
    const at = now();
    const observation = validPacket(relay, at);
    if (!observation) {
      if (seenValid && !notifiedMissing && at - lastFreshAt >= DJI_SENSOR_LOST_GRACE_MS) {
        notifiedMissing = true;
        emit({code:'telemetry-lost',severity:'warning',
          message:'🎙️ DJI Mic 3 : les batteries ne remontent plus depuis plus de 90 secondes. Vérifiez le RX et la connexion USB.'}, warnings);
      }
      return warnings;
    }
    seenValid = true;
    lastFreshAt = Date.parse(observation.observedAt);
    notifiedMissing = false;
    for (const row of observation.tx) {
      if (!row || ![1,2].includes(row.slot) || typeof row.connected !== 'boolean') continue;
      if (row.connected) {
        previouslyConnected.add(row.slot);
        if (Number.isInteger(row.rawGauge) && row.rawGauge >= 6 && row.rawGauge <= 7) {
          emit({code:'tx'+row.slot+'-gauge-'+row.rawGauge,severity:'check',
            message:'🎙️ DJI Mic 3 TX'+row.slot+' : palier '+row.rawGauge+'/7. Vérifiez le niveau sur le récepteur (pourcentage non calibré).'},warnings);
        }
      } else if (previouslyConnected.delete(row.slot)) {
        // A real connected -> disconnected transition matters immediately.
        emit({code:'tx'+row.slot+'-disconnected',severity:'critical',
          message:'🚨 DJI Mic 3 : TX'+row.slot+' vient de se déconnecter du récepteur pendant le live !'},warnings);
      }
    }
    const rx = observation.rx;
    if (Number.isInteger(rx?.rawGauge) && rx.rawGauge >= 6 && rx.rawGauge <= 7) {
      emit({code:'rx-gauge-'+rx.rawGauge,severity:'check',
        message:'🎙️ DJI Mic 3 RX : palier '+rx.rawGauge+'/7. Vérifiez sa batterie sur l’écran DJI (pourcentage non calibré).'},warnings);
    }
    return warnings;
  }
  return {check,reset};
}
