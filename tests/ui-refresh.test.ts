import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const index = readFileSync(new URL('../apps/web/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../apps/web/app.js', import.meta.url), 'utf8');

describe('rafraîchissement temps réel de l’UI', () => {
  it('ne modifie plus globalement innerHTML et ne charge aucun guard', () => {
    expect(index).not.toContain('realtime-form-guard');
    expect(app).not.toContain('Element.prototype');
  });
  it('applique les snapshots WebSocket sans rendu complet', () => {
    expect(app).toContain("if(event.type==='state.updated')applyStateUpdate(event.data)");
    expect(app).toContain('setInterval(updateTimer,250)');
  });
});
