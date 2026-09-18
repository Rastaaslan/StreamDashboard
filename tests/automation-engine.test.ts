import { describe, expect, it, vi } from 'vitest';
import { AutomationEngine } from '../packages/core/src/automation-engine.js';
import { createEventEnvelope } from '../packages/core/src/events.js';

describe('AutomationEngine', () => {
  it('exécute les actions dans l’ordre et propage la corrélation', async () => {
    const calls: string[] = [];
    const action = vi.fn(async (value, context) => { calls.push(`${value.type}:${context.correlationId}`); });
    const engine = new AutomationEngine(action);
    engine.replace([{ id: 'support-fire', name: 'Support fire', enabled: true, trigger: 'support.received', conditions: [{ path: 'amountMinor', operator: 'gte', value: 500 }], actions: [{ type: 'soundboard.play', payload: { soundId: 'fire' } }, { type: 'soundboard.play', payload: { soundId: 'gg' } }], cooldownMs: 0, lastExecutionAt: null }]);
    const result = await engine.consume(createEventEnvelope({ type: 'support.received', source: 'streamlabs', correlationId: 'donation-1', payload: { amountMinor: 500 } }));
    expect(calls).toEqual(['soundboard.play:donation-1', 'soundboard.play:donation-1']);
    expect(result).toMatchObject([{ automationId: 'support-fire', correlationId: 'donation-1', status: 'succeeded' }]);
    expect(engine.list()[0]?.lastExecutionAt).toBeTruthy();
  });

  it('arrête la séquence au premier échec sans masquer l’erreur', async () => {
    const action = vi.fn().mockRejectedValueOnce(new Error('PC audio indisponible'));
    const engine = new AutomationEngine(action);
    engine.replace([{ id: 'raid', name: 'Raid', enabled: true, trigger: 'twitch.raid', conditions: [], actions: [{ type: 'soundboard.play', payload: {} }, { type: 'second', payload: {} }], cooldownMs: 0, lastExecutionAt: null }]);
    await expect(engine.consume(createEventEnvelope({ type: 'twitch.raid', source: 'twitch', payload: { viewers: 20 } }))).resolves.toMatchObject([{ status: 'failed', error: 'PC audio indisponible' }]);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
