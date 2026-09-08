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

  it('publie un événement d’état versionnable', () => {
    const event = { type: 'state.updated' } as DashboardEvent;
    expect(event.type).toBe('state.updated');
  });
});
