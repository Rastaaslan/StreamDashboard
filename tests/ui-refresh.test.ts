import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const index = readFileSync(new URL('../apps/web/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../apps/web/app.js', import.meta.url), 'utf8');

describe('rafraîchissement temps réel de l’UI', () => {
  it('ne modifie plus globalement innerHTML et ne charge aucun guard', () => {
    expect(index).not.toContain('realtime-form-guard');
    expect(app).not.toContain('Element.prototype');
  });

  it('applique les snapshots WebSocket et maintient le timer local', () => {
    expect(app).toMatch(/message\.type\s*===\s*['"]state\.updated['"]/);
    expect(app).toContain('applyStateUpdate(message.data)');
    expect(app).toMatch(/setInterval\(updateTimer,\s*250\)/);
  });

  it('protège un formulaire modifié contre les snapshots temps réel', () => {
    expect(app).toContain('data-dirty="true"');
    expect(app).toContain("if (dirtyForm())");
    expect(app).toContain('updateSettingsRuntime()');
  });

  it('désactive les contrôles de diffusion lorsque OBS est hors ligne', () => {
    expect(app).toContain("const offline = !state.obs.connected");
    expect(app).toContain("offline ? 'disabled' : ''");
    expect(app).toContain("if (!obs.connected)");
  });
});
