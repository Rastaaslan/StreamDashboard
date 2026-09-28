/** HTTP command coordinator. Realtime transport is deliberately not a dependency. */
export function createCommandController({ send, readState, applyState, onMessage = () => {}, getGeneration = () => 0 }) {
  const locks = new Map();

  async function execute(value, { resource = value.type, timeoutMs, reconcile } = {}) {
    const generation = getGeneration();
    const stale = () => generation !== getGeneration();
    const discarded = () => ({ accepted: false, reason: 'stale' });
    if (locks.get(resource) === generation) return { accepted: false, reason: 'busy' };
    locks.set(resource, generation);
    try {
      const body = await send(value, { timeoutMs });
      if (stale()) return discarded();
      if (body?.state) applyState(body.state);
      return { accepted: true, body, reconciled: false };
    } catch (error) {
      if (stale()) return discarded();
      if (reconcile) {
        try {
          const current = await readState();
          if (stale()) return discarded();
          applyState(current);
          const streamTarget = value.type === 'session.start' ? true : value.type === 'session.stop' ? false : value.type === 'obs.stream' ? value.start : undefined;
          if ((streamTarget === undefined || confirmsObsStreaming(current, streamTarget)) && reconcile(current)) {
            onMessage('Commande confirmée après resynchronisation.');
            return { accepted: true, body: { state: current }, reconciled: true };
          }
        } catch (reconciliationError) {
          if (stale()) return discarded();
          throw new AggregateError(
            [error, reconciliationError],
            `${error.message} La réconciliation de l’état a également échoué.`,
          );
        }
      }
      throw error;
    } finally {
      if (locks.get(resource) === generation) locks.delete(resource);
    }
  }

  return { execute, isLocked: resource => locks.get(resource) === getGeneration() };
}

export function primaryMicCommand(state) {
  const input = state?.settings?.primaryMicInput;
  if (!input) throw new Error('Micro principal non configuré.');
  const current = state?.obs?.inputs?.[input];
  if (!current) throw new Error('Micro principal introuvable.');
  return { type: 'obs.mute', input, muted: !current.muted };
}

export function acceptsSnapshot(current, incoming) {
  if (incoming?.serverInstanceId && incoming.serverInstanceId !== current?.serverInstanceId) return true;
  return !(Number.isInteger(incoming?.stateRevision) && Number.isInteger(current?.stateRevision)
    && incoming.stateRevision < current.stateRevision);
}

/** Last-known OBS telemetry is never a stream confirmation. */
export function confirmsObsStreaming(state, expected) {
  return state?.obs?.connected === true && state.obs.streamingKnown === true
    && state.obs.streaming === expected;
}

/** Shared wording and command availability for both mobile shells. */
export function obsRuntimeView(state) {
  const obs = state?.obs || {};
  const known = obs.connected === true && obs.streamingKnown === true;
  const streaming = known && obs.streaming === true;
  const status = obs.connected ? 'connected' : obs.connectionStatus === 'connecting' ? 'connecting'
    : obs.connectionStatus === 'error' ? 'error' : 'offline';
  const connectionLabel = { connected: 'Connecté', connecting: 'Connexion…', error: 'Erreur', offline: 'Déconnecté' }[status];
  const obsLabel = known ? streaming ? 'En direct · OBS' : 'Hors live · OBS' : 'OBS : état du live inconnu';
  const twitchLive = state?.controlHub?.live?.isLive === true;
  return {
    known, streaming, status, connectionLabel, obsLabel,
    providerStatus: { connected: 'CONNECTED', connecting: 'CONNECTING', error: 'ERROR', offline: 'DISCONNECTED' }[status],
    live: streaming || twitchLive,
    liveLabel: twitchLive ? `En direct · Twitch — ${obsLabel}` : obsLabel,
    buttonLabel: !known ? 'État OBS inconnu' : streaming ? 'Arrêter le live' : 'Démarrer le live',
  };
}
