import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../apps/web/app.js', import.meta.url), 'utf8');

describe('rafraîchissement temps réel de l’UI', () => {
  it('ne reconstruit pas la vue pendant une saisie utilisateur', () => {
    expect(app).toContain('function isUserEditing()');
    expect(app).toContain("if(event.type==='state.updated'){state=event.data;if(isUserEditing())renderChrome();else render()}");
  });
});
