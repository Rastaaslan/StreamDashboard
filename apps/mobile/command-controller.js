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
        } catch { /* Preserve the original command error. */ }
      }
      throw error;
    } finally {
      locks.delete(resource);
    }
  }

  return { execute, isLocked: resource => locks.has(resource) };
}
