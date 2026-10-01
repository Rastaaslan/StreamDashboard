import { describe, expect, it, vi } from 'vitest';
import { AutomationRuntime } from '../apps/server/src/automation-runtime.js';
import { createEventEnvelope } from '../packages/core/src/events.js';

describe('AutomationRuntime persistence', () => {
  it('crée, édite, désactive, supprime et persiste', async () => {
    const writes: unknown[] = []; const runtime = new AutomationRuntime([], async () => undefined, async values => { writes.push(values); });
    const created = await runtime.create({ name: 'Bonk soutien', enabled: true, trigger: 'support.received', conditions: [], actions: [{ type: 'soundboard.play', payload: { soundId: 'bonk' } }], cooldownMs: 1_000 });
    expect(runtime.list()).toHaveLength(1); await runtime.update(created.id, { enabled: false, name: 'Bonk off' }); expect(runtime.list()[0]).toMatchObject({ enabled: false, name: 'Bonk off' }); await runtime.remove(created.id); expect(runtime.list()).toEqual([]); expect(writes).toHaveLength(3);
  });

  it('branche un Domain Event vers une action corrélée et persiste le résultat', async () => {
    const action = vi.fn(async () => undefined); const persist = vi.fn(async () => undefined);
    const runtime = new AutomationRuntime([{ id: 'one', name: 'Support', enabled: true, trigger: 'support.received', conditions: [], actions: [{ type: 'soundboard.play', payload: { soundId: 'bonk' } }], cooldownMs: 0, lastExecutionAt: null }], action, persist);
    const result = await runtime.consume(createEventEnvelope({ type: 'support.received', source: 'test', correlationId: 'support-1', payload: { amountMinor: 500 } }));
    expect(action).toHaveBeenCalledWith(expect.objectContaining({ type: 'soundboard.play' }), expect.objectContaining({ correlationId: 'support-1' })); expect(result[0]).toMatchObject({ status: 'succeeded' }); expect(runtime.list()[0]?.lastResult).toMatchObject({ status: 'succeeded' }); expect(persist).toHaveBeenCalled();
  });
});
