import { describe, expect, it, vi } from 'vitest';
import { DashboardCommandService, type ObsCommands } from '../apps/server/src/command-service.js';

function setup() {
  const domain = { mode: 'idle' as const, timer: { running: false, duration: 300, remaining: 300, deadline: null }, checklist: [] };
  const obs: ObsCommands = {
    scene: vi.fn(), mute: vi.fn(), volume: vi.fn(), stream: vi.fn(), record: vi.fn(), restartMedia: vi.fn(), refresh: vi.fn(),
  };
  const commit = vi.fn(async () => ({ ok: true }) as never);
  return { service: new DashboardCommandService(domain, obs, commit), obs, commit };
}

describe('service de commandes', () => {
  it('borne le volume avant de déléguer à OBS', async () => {
    const { service, obs, commit } = setup();
    await service.execute({ type: 'obs.volume', input: 'Micro', volume: 9 });
    expect(obs.volume).toHaveBeenCalledWith('Micro', 1.5);
    expect(obs.refresh).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
  });

  it('rejette une commande inconnue reçue par HTTP', async () => {
    const { service, commit } = setup();
    await expect(service.execute({ type: 'inconnue' } as never)).rejects.toThrow(/inconnue/);
    expect(commit).not.toHaveBeenCalled();
  });
});
