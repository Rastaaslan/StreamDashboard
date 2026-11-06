/** Read-only readiness for the legacy Windows cockpit banner.
 * A live account connection is not a validated start preflight.
 * This projection never authorizes OBS/Twitch commands.
 */
export function classicDashboardReadiness(state) {
  const obs = state?.obs || {};
  // This flag is local to the legacy UI, never part of OBS/server authority.
  // An old snapshot cannot certify readiness or an ongoing live after WS loss.
  const observationTrusted = state?.uiObservationTrusted !== false;
  const connections = Boolean(observationTrusted && state?.runtime && obs.connected && state?.twitch?.connected);
  const knownObsState = observationTrusted && obs.streamingKnown !== false && typeof obs.streaming === 'boolean';
  const checklist = Array.isArray(state?.checklist) && state.checklist.length > 0
    && state.checklist.every(item => item?.done === true);
  const preflight = state?.preflight?.status === 'ready';
  const live = knownObsState && obs.streaming === true;
  return {
    ready: connections && knownObsState && checklist && preflight && !live,
    live,
  };
}
