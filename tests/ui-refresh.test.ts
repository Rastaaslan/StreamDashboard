import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const index = readFileSync(new URL('../apps/web/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../apps/web/app.js', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../apps/mobile/mobile.js', import.meta.url), 'utf8');
const mobileIndex = readFileSync(new URL('../apps/mobile/index.html', import.meta.url), 'utf8');
const overlay = readFileSync(new URL('../apps/web/overlay/timer/timer.js', import.meta.url), 'utf8');
const overlayCss = readFileSync(new URL('../apps/web/overlay/timer/timer.css', import.meta.url), 'utf8');

describe('rafraîchissement temps réel de l’UI', () => {
  it('ne modifie plus globalement innerHTML et ne charge aucun guard', () => {
    expect(index).not.toContain('realtime-form-guard');
    expect(app).not.toContain('Element.prototype');
  });

  it('applique les snapshots WebSocket et maintient le timer local à la seconde', () => {
    expect(app).toMatch(/message\.type\s*===\s*['"]state\.updated['"]/);
    expect(app).toContain('applyStateUpdate(message.data)');
    expect(app).toMatch(/setInterval\(updateTimer,\s*1000\)/);
  });

  it('borne les requêtes UI pour ne pas laisser les commandes bloquées indéfiniment', () => {
    expect(app).toContain('const REQUEST_TIMEOUT_MS = 30_000');
    expect(app).toContain('new AbortController()');
    expect(app).toContain('signal: controller.signal');
  });

  it('protège un formulaire modifié contre les snapshots temps réel', () => {
    expect(app).toContain('data-dirty="true"');
    expect(app).toContain('if (dirtyForm())');
    expect(app).toContain('updateSettingsRuntime()');
  });

  it('désactive les contrôles de diffusion lorsque OBS est hors ligne', () => {
    expect(app).toContain('const offline = !state.obs.connected');
    expect(app).toContain("offline ? 'disabled' : ''");
    expect(app).toContain('if (!obs.connected)');
  });

  it('filtre aussi le mixer mobile avec la liste audio active canonique', () => {
    expect(mobile).toContain('renderAudio(next.obs.inputs, next.obs.activeAudioInputs)');
    expect(mobile).toContain('activeInputs.includes(name)');
    expect(mobile).toContain('Télécommande connectée au PC.');
  });

  it('offre les quatre presets timer sur Desktop et Android', () => {
    for (const seconds of [60, 120, 300, 600]) {
      expect(app).toContain(`data-seconds="${seconds}"`);
      expect(mobileIndex).toContain(`data-seconds="${seconds}"`);
    }
  });

  it('conserve le timer canonique mais masque explicitement le chrono en End', () => {
    expect(overlay).toContain("end:{kicker:'LE FEU DE CAMP DE DAM'");
    expect(overlayCss).toContain('main.end #timer-wrap{display:none}');
    expect(overlayCss).toContain('background:transparent!important');
  });
});
