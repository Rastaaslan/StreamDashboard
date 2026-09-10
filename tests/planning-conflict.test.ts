import { describe, expect, it, vi } from 'vitest';
import { PlanningOrchestrator, type PlanningProvider } from '../packages/core/src/planning.js';

const event = { title: 'Local', startAtUtc: '2030-01-01T10:00:00.000Z', endAtUtc: '2030-01-01T11:00:00.000Z', category: 'live' as const };
const provider = (): PlanningProvider & { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } => ({
  create: vi.fn(async () => ({ id: 'remote-1', revision: 'etag-old' })),
  update: vi.fn(async () => ({ revision: 'etag-new' })),
  delete: vi.fn(async () => undefined),
});

describe('résolution explicite des conflits planning', () => {
  it('adopte la version distante sans écraser silencieusement le provider', async () => {
    const google = provider();
    const planning = new PlanningOrchestrator([], { google }, async () => undefined);
    const item = await planning.create({ ...event, desiredPublication: { local: true, twitch: false, google: true } });
    await planning.markConflict(item.id, 'google', { title: 'Remote', startAtUtc: '2030-01-01T12:00:00.000Z', endAtUtc: '2030-01-01T13:00:00.000Z' });
    const resolved = await planning.resolveConflict(item.id, 'google', 'remote');
    expect(resolved.title).toBe('Remote');
    expect(resolved.conflict).toBeUndefined();
    expect(resolved.providers?.google?.status).toBe('synced');
    expect(google.update).not.toHaveBeenCalled();
  });

  it('le choix local est une action explicite et force une nouvelle révision distante', async () => {
    const google = provider();
    const planning = new PlanningOrchestrator([], { google }, async () => undefined);
    const item = await planning.create({ ...event, desiredPublication: { local: true, twitch: false, google: true } });
    await planning.markConflict(item.id, 'google', { title: 'Remote', startAtUtc: event.startAtUtc, endAtUtc: event.endAtUtc });
    const resolved = await planning.resolveConflict(item.id, 'google', 'local');
    expect(resolved.title).toBe('Local');
    expect(resolved.conflict).toBeUndefined();
    expect(resolved.providers?.google?.status).toBe('synced');
    expect(google.update).toHaveBeenCalledWith('remote-1', expect.objectContaining({ title: 'Local' }), undefined);
  });

  it('un retry générique refuse de choisir implicitement une version en conflit', async () => {
    const google = provider();
    const planning = new PlanningOrchestrator([], { google }, async () => undefined);
    const item = await planning.create({ ...event, desiredPublication: { local: true, twitch: false, google: true } });
    await planning.markConflict(item.id, 'google', { title: 'Remote', startAtUtc: event.startAtUtc, endAtUtc: event.endAtUtc });
    await expect(planning.retry(item.id, 'google')).rejects.toThrow(/choisissez/i);
  });
});
