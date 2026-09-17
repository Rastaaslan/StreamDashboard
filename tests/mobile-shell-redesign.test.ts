import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../apps/mobile/index.html', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../apps/mobile/mobile.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../apps/mobile/mobile-shell.css', import.meta.url), 'utf8');

describe('Android five-tab control shell', () => {
  it('expose exactement cinq destinations primaires dans l’ordre demandé', () => {
    const tabs = [...html.matchAll(/<button data-tab="([^"]+)"/g)].map(match => match[1]);
    expect(tabs).toEqual(['home', 'live', 'sounds', 'planning', 'more']);
    expect(html).toContain('aria-label="Navigation principale"');
    expect(html).not.toContain('data-tab="regie"');
  });

  it('rend Live, Soundboard, Planning et Plus accessibles sans ancien portail Outils live', () => {
    for (const view of ['home', 'live', 'sounds', 'planning', 'more', 'prepare', 'settings']) expect(html).toContain(`data-view="${view}"`);
    expect(html).not.toContain('<small>OUTILS LIVE</small>');
    for (const feature of ['data-hub-panel="chat"', 'data-hub-panel="audience"', 'data-hub-panel="supports"', 'data-hub-panel="vod"', 'data-hub-panel="clips"', 'id="primary-soundboard"', 'id="more-automations"', 'id="diagnostics"']) expect(html).toContain(feature);
  });

  it('décrit explicitement les états vides, offline et providers en langage humain', () => {
    expect(mobile).toContain('Aucun son configuré.');
    expect(mobile).toContain('PC StreamDashboard hors ligne.');
    expect(mobile).toContain('Aucune VOD disponible.');
    expect(mobile).toContain('Streamlabs n’est pas encore connecté.');
    expect(mobile).toContain("NOT_CONFIGURED: 'Non configuré'");
    expect(html).toContain('Diagnostics développeur · Events');
  });

  it('définit le système visuel, les touch targets, focus et reduced motion', () => {
    for (const token of ['--bg:', '--surface:', '--border:', '--accent:', '--ember:', '--motion:']) expect(css).toContain(token);
    expect(css).toContain('min-height:44px');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('prefers-reduced-motion:reduce');
    expect(html.match(/<svg /g)).toHaveLength(5);
  });
});
