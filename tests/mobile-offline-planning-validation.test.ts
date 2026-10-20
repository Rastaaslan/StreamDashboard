import { expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ openReplica: vi.fn(), newId: () => 'local-event' }));
vi.mock('../apps/mobile/control/autonomy-store.js', () => storage);
// @ts-expect-error Browser module is shipped as JavaScript.
import { createAutonomy } from '../apps/mobile/control/autonomy.js';
// @ts-expect-error Browser module is shipped as JavaScript.
import { newWorkspace } from '../apps/mobile/control/device-workspace.js';

it('refuse une date de fin invalide avant de journaliser une création hors connexion', async () => {
  const bundle = newWorkspace({ name: 'Téléphone' }).bundle;
  const stage = vi.fn();
  storage.openReplica.mockResolvedValue({ view: () => structuredClone(bundle), stage });
  const network = vi.fn();
  const autonomy = await createAutonomy('test', network);
  const event = { title: 'Préparation', category: 'live', startAtUtc: '2030-11-01T18:00:00Z' };
  for (const endAtUtc of ['', undefined, 'not-a-date', '2030-11-01T17:00:00Z']) {
    await expect(autonomy.mutate('/api/v2/planning', { ...event, endAtUtc }, 'POST')).rejects.toThrow('période valides');
  }
  expect(stage).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
  await autonomy.mutate('/api/v2/planning', { ...event, endAtUtc: '2030-11-01T19:00:00Z' }, 'POST');
  expect(stage).toHaveBeenCalledTimes(1);
});
