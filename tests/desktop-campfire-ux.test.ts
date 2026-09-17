import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../apps/web/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../apps/web/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../apps/web/style.css', import.meta.url), 'utf8');

describe('Desktop Campfire console', () => {
  it('expose une sidebar stable sans navigation mobile', () => {
    for (const page of ['Accueil', 'Live', 'Préparer', 'Planning', 'Sons', 'Soutiens', 'Automatisations', 'Connexions', 'Réglages']) expect(app).toContain(`'${page}'`);
    expect(html).toContain('<aside aria-label="Navigation principale">');
    expect(html).not.toContain('bottom-nav');
  });

  it('utilise une préparation à intention unique', () => {
    for (const view of ['checklist', 'notes', 'templates']) expect(app).toContain(`data-preparation-view="${view}"`);
    expect(app).toContain('streamdashboard.desktopPreparationView');
    expect(app).toContain('class="semantic-stack"');
    expect(app).toContain('<details>');
  });

  it('garde planning et configuration avancée en divulgation progressive', () => {
    expect(app).toContain('class="panel space planning-tools"');
    expect(app).toContain('<summary>Outils du planning</summary>');
    expect(app).toContain('id="event-dialog"');
  });

  it('définit la console Campfire Purple et un focus local', () => {
    for (const token of ['--bg-0:', '--surface-1:', '--purple-deep:', '--purple-ember:', '--purple-core:', '--text-primary:']) expect(css).toContain(token);
    expect(html).toContain('id="desktop-focus"');
    expect(app).toContain('streamdashboard.desktopFocus');
    expect(css).toContain('.desktop-focus');
  });

  it('ne publie aucun secret dans le shell', () => {
    expect(html).not.toMatch(/token|password|secret|authorization/i);
    expect(app).toContain('type="password"');
  });
});
