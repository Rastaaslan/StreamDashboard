import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const index = readFileSync(new URL('../apps/web/index.html', import.meta.url), 'utf8');
const guard = readFileSync(new URL('../apps/web/realtime-form-guard.js', import.meta.url), 'utf8');

describe('rafraîchissement temps réel de l’UI', () => {
  it('charge la protection des formulaires avant app.js', () => {
    expect(index.indexOf('/realtime-form-guard.js')).toBeGreaterThan(-1);
    expect(index.indexOf('/realtime-form-guard.js')).toBeLessThan(index.indexOf('/app.js'));
  });

  it('préserve les formulaires en cours de saisie', () => {
    expect(guard).toContain("element.querySelector('form[data-dirty=\"true\"]')");
    expect(guard).toContain("['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)");
  });
});
