import { describe, expect, it } from 'vitest';
// @ts-expect-error This browser JS module has no TypeScript declaration.
import { newWorkspace } from '../apps/mobile/control/device-workspace.js';
type SceneAction = { type: string; value: string; label: string; shortcut: string };

describe('Intro / Pause / Fin scene mode defaults', () => {
  it('provides distinct explicit mode buttons without live start/stop commands', () => {
    const workspace = newWorkspace({ name: 'QA FIXE' });
    const actions: SceneAction[] = workspace.bundle.data.configuration.actions;
    for (const mode of ['intro', 'pause', 'end']) {
      const matches = actions.filter(action => action.type === 'mode.set' && action.value === mode);
      expect(matches).toHaveLength(1);
      expect(matches[0].label).toBeTruthy();
    }
    expect(actions.some(action => ['live.start', 'live.stop'].includes(action.type))).toBe(false);
    expect(new Set(actions.map(action => action.shortcut)).size).toBe(actions.length);
    expect(workspace.bundle.data.host.settings.modeScenes).toEqual({});
    expect(workspace.bundle.data.host.settings.startMode).toBe('intro');
  });
});
