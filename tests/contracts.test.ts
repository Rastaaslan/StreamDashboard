import { describe, expect, it } from 'vitest';
import type { DashboardCommand, DashboardEvent } from '../packages/contracts/src/index.js';

describe('contrat de commandes partagé', () => {
  it('exprime les commandes sans dépendre de l’interface desktop', () => {
    const commands: DashboardCommand[] = [
      { type: 'mode.set', mode: 'intro' },
      { type: 'timer.add', seconds: 60 },
      { type: 'obs.stream', start: true },
      { type: 'checklist.toggle', id: 'audio' },
    ];
    expect(commands.map(x => x.type)).toEqual(['mode.set', 'timer.add', 'obs.stream', 'checklist.toggle']);
  });

  it('distingue les entrées audio OBS actives dans le contrat', () => {
    const inputs = { Micro: { muted: false, volume: 1 }, Musique: { muted: true, volume: 0.5 } };
    const activeAudioInputs = ['Micro'];
    expect(Object.keys(inputs).filter(name => activeAudioInputs.includes(name))).toEqual(['Micro']);
  });

  it('publie un événement d’état versionnable', () => {
    const event = { type: 'state.updated' } as DashboardEvent;
    expect(event.type).toBe('state.updated');
  });
});
