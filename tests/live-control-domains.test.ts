import { describe, expect, it } from 'vitest';
import { createEventEnvelope } from '../packages/core/src/events.js';
import { audienceSnapshot, matchAutomation, SupportHistory, type Automation } from '../packages/core/src/live-control-domains.js';

describe('live control domains', () => {
  it('stores money in minor units and deduplicates provider deliveries', () => {
    const history = new SupportHistory();
    const support = { id: 'one', provider: 'streamlabs', externalId: 'ABC', displayName: 'UserA', amountMinor: 500, currency: 'EUR', message: 'GG', receivedAt: '2026-09-16T10:00:00Z' };
    expect(history.record(support).inserted).toBe(true);
    expect(history.record({ ...support, id: 'duplicate' }).inserted).toBe(false);
    expect(history.total('EUR')).toBe(500);
    expect(() => history.record({ ...support, externalId: 'float', amountMinor: 12.5 })).toThrow(/unités mineures/);
  });

  it('keeps viewer count separate from the chatter roster', () => {
    const audience = audienceSnapshot({ viewerCount: 17, chatters: [{ id: '1', displayName: 'DamDam', role: 'broadcaster' }, { id: '2', displayName: 'User', role: 'unknown' }] });
    expect(audience.viewerCount).toBe(17);
    expect(audience.chatters).toEqual([{ id: '1', displayName: 'DamDam', role: 'broadcaster' }, { id: '2', displayName: 'User', role: 'viewer' }]);
  });

  it('matches AND conditions and enforces cooldowns', () => {
    const event = createEventEnvelope({ type: 'support.received', source: 'streamlabs', payload: { amountMinor: 500, currency: 'EUR' } });
    const automation: Automation = { id: 'fire', name: 'Fire', enabled: true, trigger: 'support.received', conditions: [{ path: 'amountMinor', operator: 'gte', value: 500 }, { path: 'currency', operator: 'eq', value: 'EUR' }], actions: [{ type: 'soundboard.play', payload: { soundId: 'fire' } }], cooldownMs: 30_000, lastExecutionAt: null };
    expect(matchAutomation(automation, event, Date.parse('2026-09-16T10:00:00Z'))).toBe(true);
    expect(matchAutomation({ ...automation, lastExecutionAt: '2026-09-16T09:59:50Z' }, event, Date.parse('2026-09-16T10:00:00Z'))).toBe(false);
  });
});
