/** HTTP command coordinator. Realtime transport is deliberately not a dependency. */
export function createCommandController({ send, readState, applyState, onMessage = () => {} }) {
  const locks = new Set();

  async function execute(value, { resource = value.type, timeoutMs, reconcile } = {}) {
    if (locks.has(resource)) return { accepted: false, reason: 'busy' };
    locks.add(resource);
    try {
      const body = await send(value, { timeoutMs });
      if (body?.state) applyState(body.state);
      return { accepted: true, body, reconciled: false };
    } catch (error) {
      if (reconcile) {
        try {
          const current = await readState();
          applyState(current);
          if (reconcile(current)) {
            onMessage('Commande confirmée après resynchronisation.');
            return { accepted: true, body: { state: current }, reconciled: true };
          }
        } catch (reconciliationError) {
          throw new AggregateError(
            [error, reconciliationError],
            `${error.message} La réconciliation de l’état a également échoué.`,
          );
        }
      }
      throw error;
    } finally {
      locks.delete(resource);
    }
  }

  return { execute, isLocked: resource => locks.has(resource) };
}

export function primaryMicCommand(state) {
  const input = state?.settings?.primaryMicInput;
  if (!input) throw new Error('Micro principal non configuré.');
  const current = state?.obs?.inputs?.[input];
  if (!current) throw new Error('Micro principal introuvable.');
  return { type: 'obs.mute', input, muted: !current.muted };
}

export function acceptsSnapshot(current, incoming) {
  return !(Number.isInteger(incoming?.stateRevision) && Number.isInteger(current?.stateRevision)
    && incoming.stateRevision < current.stateRevision);
}
