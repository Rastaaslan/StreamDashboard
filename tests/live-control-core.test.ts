import { describe, expect, it, vi } from 'vitest';
import { ActionCore } from '../packages/core/src/actions.js';
import { createEventEnvelope, EventCore } from '../packages/core/src/events.js';
import { integrationState, transitionIntegration } from '../packages/core/src/integrations.js';

describe('live control core', () => {
  it('normalizes and correlates events', () => {
    const event = createEventEnvelope({ type: 'support.received', source: 'streamlabs', payload: { amountMinor: 500 }, correlationId: 'trace-1' }, () => new Date('2026-09-16T01:00:00Z'));
    expect(event).toMatchObject({ schemaVersion: 1, type: 'support.received', source: 'streamlabs', occurredAt: '2026-09-16T01:00:00.000Z', receivedAt: '2026-09-16T01:00:00.000Z', correlationId: 'trace-1' });
    expect(event.eventId).toBeTruthy();
  });

  it('keeps diagnostics bounded', () => {
    const events = new EventCore(2);
    events.publish({ type: 'obs.connected', source: 'obs', payload: {} });
    events.publish({ type: 'obs.scene.changed', source: 'obs', payload: { scene: 'Intro' } });
    events.publish({ type: 'obs.disconnected', source: 'obs', payload: {} });
    expect(events.recent().map(event => event.type)).toEqual(['obs.scene.changed', 'obs.disconnected']);
  });

  it('deduplicates in-flight and completed non-idempotent commands', async () => {
    const actions = new ActionCore();
    const handler = vi.fn(async () => undefined);
    const command = { commandId: 'device:42', type: 'soundboard.play', origin: 'android' as const, issuedAt: new Date().toISOString(), payload: { soundId: 'bonk' } };
    const [first, retry] = await Promise.all([actions.execute(command, handler), actions.execute(command, handler)]);
    const lateRetry = await actions.execute(command, handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(retry).toEqual(first);
    expect(lateRetry).toEqual(first);
  });

  it('tracks integration degradation and recovery', () => {
    const degraded = transitionIntegration(integrationState('CONNECTED'), 'DEGRADED', { at: '2026-09-16T01:00:00Z', error: { code: 'TIMEOUT', message: 'Provider timeout', retryable: true, details: null } });
    expect(degraded).toMatchObject({ status: 'DEGRADED', retryState: { attempt: 1 }, lastError: { code: 'TIMEOUT', retryable: true } });
    expect(transitionIntegration(degraded, 'CONNECTED', { at: '2026-09-16T01:01:00Z' })).toMatchObject({ status: 'CONNECTED', lastConnectedAt: '2026-09-16T01:01:00.000Z', lastError: null, retryState: { attempt: 0 } });
  });
});
