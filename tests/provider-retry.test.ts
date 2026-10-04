import { expect, it, vi } from 'vitest';
import { PlanningOrchestrator } from '../packages/core/src/planning.js';
import type { CalendarItem } from '../packages/contracts/src/index.js';

for (const provider of ['google', 'twitch'] as const) {
  const item = (): CalendarItem => ({ id: 'local', title: 'Desired', startAtUtc: '2030-10-01T18:00:00Z', endAtUtc: '2030-10-01T19:00:00Z',
    desiredPublication: { local: true, google: provider === 'google', twitch: provider === 'twitch' },
    providers: { [provider]: { status: 'error', remoteId: 'remote', remoteRevision: 'etag', deletedRemotely: true } } });
  it(`${provider}: preserves identity when deletion verification fails, then recreates only a confirmed deletion`, async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('Reconnectez le compte')).mockResolvedValue({ deleted: true });
    const create = vi.fn(async () => ({ id: 'replacement', revision: 'new' }));
    const update = vi.fn();
    const planning = new PlanningOrchestrator([item()], { [provider]: { read, create, update, delete: vi.fn() } }, async () => {});
    await expect(planning.retry('local', provider)).rejects.toThrow('Reconnectez le compte');
    expect(planning.all()[0].providers?.[provider]).toMatchObject({ remoteId: 'remote', remoteRevision: 'etag', deletedRemotely: true, lastError: 'Reconnectez le compte' });
    expect(create).not.toHaveBeenCalled();
    const result = await planning.retry('local', provider);
    expect(result.providers?.[provider]).toMatchObject({ remoteId: 'replacement', remoteRevision: 'new', status: 'synced', deletedRemotely: false });
    expect(create).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });
  it(`${provider}: retains the original concurrency token when the supposedly deleted object exists`, async () => {
    const value = item(); value.providers![provider]!.fingerprint = 'original-fingerprint';
    const read = vi.fn(async () => ({ revision: 'new-remote-etag', fingerprint: 'new-remote-fingerprint' }));
    const update = vi.fn(async (_id: string, request: CalendarItem, revision?: string) => {
      expect(revision).toBe('etag');
      expect(request.providers?.[provider]?.fingerprint).toBe('original-fingerprint');
      throw Object.assign(new Error('Modification distante : choisissez une version'), { status: 412 });
    });
    const create = vi.fn();
    const planning = new PlanningOrchestrator([value], { [provider]: { read, create, update, delete: vi.fn() } }, async () => {});
    await expect(planning.retry('local', provider)).rejects.toThrow(/Modification distante/);
    expect(planning.all()[0]).toMatchObject({ conflict: { provider }, providers: { [provider]: { status: 'conflict', remoteId: 'remote', remoteRevision: 'etag' } } });
    expect(create).not.toHaveBeenCalled();
  });
  it(`${provider}: a provider-link conflict requires an explicit resolution`, async () => {
    const value = item(); value.providers![provider]!.status = 'conflict';
    const create = vi.fn(), update = vi.fn();
    const planning = new PlanningOrchestrator([value], { [provider]: { create, update, delete: vi.fn() } }, async () => {});
    await expect(planning.retry('local', provider)).rejects.toThrow(/Conflit.*non résolu/);
    expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  });
}
