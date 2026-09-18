export const COMMAND_TIMEOUT_MS = 15_000;
export const CRITICAL_COMMAND_TIMEOUT_MS = 30_000;

const resourceFor = command => {
  if (command.type === 'session.start' || command.type === 'session.stop') return 'stream';
  if (command.type === 'mode.set' || command.type === 'obs.scene' || command.type === 'scene.chatting') return 'scene';
  if (command.type === 'obs.mute' || command.type === 'obs.volume' || command.type === 'obs.volumeDb') return `audio:${command.input}`;
  if (command.type.startsWith('timer.')) return 'timer';
  if (command.type.startsWith('checklist.')) return `checklist:${command.id || 'all'}`;
  return command.type;
};

const postcondition = (command, state) => {
  if (!state) return false;
  if (command.type === 'session.start') return state.obs?.streaming === true;
  if (command.type === 'session.stop') return state.obs?.streaming === false;
  if (command.type === 'mode.set') return state.mode === command.mode;
  if (command.type === 'obs.scene') return state.obs?.scene === command.scene;
  if (command.type === 'obs.mute') return state.obs?.inputs?.[command.input]?.muted === command.muted;
  return false;
};

export function createMobileCommandController({ transport, getCredential, applyState, notify, makeId = () => crypto.randomUUID() }) {
  const locks = new Set();
  const execute = async command => {
    if (!getCredential()) throw new Error('Télécommande non appairée.');
    const resource = resourceFor(command);
    if (locks.has(resource)) return { skipped: true, reason: 'already-running' };
    locks.add(resource);
    const commandId = makeId();
    const critical = ['session.start', 'session.stop'].includes(command.type);
    try {
      const result = await transport.command(command, { commandId, timeoutMs: critical ? CRITICAL_COMMAND_TIMEOUT_MS : COMMAND_TIMEOUT_MS });
      if (result?.state) applyState(result.state);
      return result;
    } catch (error) {
      if (error?.name !== 'RequestTimeoutError' || !critical) throw error;
      notify?.('Confirmation du PC en cours…');
      const reconciled = await transport.state({ timeoutMs: COMMAND_TIMEOUT_MS });
      applyState(reconciled);
      if (postcondition(command, reconciled)) return { ok: true, reconciled: true, state: reconciled };
      throw new Error('Le PC répond, mais OBS n’a pas confirmé la commande. Vérifie son état avant de réessayer.');
    } finally { locks.delete(resource); }
  };
  return { execute, isLocked: resource => locks.has(resource), resourceFor };
}

export function shouldApplyState(current, incoming) {
  return !(current?.stateRevision !== undefined && incoming?.stateRevision !== undefined && incoming.stateRevision < current.stateRevision);
}
