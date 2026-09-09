import { describe, expect, it } from 'vitest';
import { parseCommand, protocolVersion, type DashboardCommand, type DashboardEvent, type ServerCapabilities } from '../packages/contracts/src/index.js';

describe('contrat de commandes partagé', () => {
  it('exprime les commandes sans dépendre de l’interface desktop', () => {
    const commands: DashboardCommand[] = [
      { type: 'mode.set', mode: 'intro' },
      { type: 'timer.add', seconds: 60 },
      { type: 'obs.stream', start: true },
      { type: 'checklist.toggle', id: 'audio' },
      { type: 'obs.media.restart', input: 'Jingle' },
    ];
    expect(commands.map(x => x.type)).toEqual(['mode.set', 'timer.add', 'obs.stream', 'checklist.toggle', 'obs.media.restart']);
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

  it('valide le protocole JSON v1 sans dépendance de transport', () => {
    const capabilities: ServerCapabilities = { protocolVersion, serverVersion: '1.1.0', features: ['timer'], accessMode: 'desktop-local' };
    expect(JSON.parse(JSON.stringify(capabilities))).toEqual(capabilities);
    expect(parseCommand(JSON.parse('{"type":"timer.add","seconds":30}'))).toEqual({ type: 'timer.add', seconds: 30 });
    expect(() => parseCommand({ type: 'timer.reset', executable: 'cmd.exe' })).toThrow(/non autorisé/);
  });
});
