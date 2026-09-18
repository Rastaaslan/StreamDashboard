import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const desktopHtml = readFileSync(new URL('../apps/web/index.html', import.meta.url), 'utf8');
const desktop = readFileSync(new URL('../apps/web/app.js', import.meta.url), 'utf8');
const mobileHtml = readFileSync(new URL('../apps/mobile/index.html', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../apps/mobile/mobile.js', import.meta.url), 'utf8');

describe('efficient UI contract', () => {
  it('keeps desktop high-frequency actions one click away and contextual', () => {
    expect(desktopHtml).toContain('id="quick-actions"');
    for (const action of ['Préparer', 'Démarrer', 'Live', 'Pause', 'Micro', 'Scènes', 'Planning']) {
      expect(desktop).toContain(action);
    }
    expect(desktop).toContain("'toggle-primary-mic': window.togglePrimaryMic");
    expect(desktop).toContain("const preflightReady = state.preflight?.status === 'ready'");
  });

  it('provides safe desktop navigation shortcuts without firing while typing', () => {
    expect(desktop).toContain("target.matches('input, textarea, select')");
    expect(desktop).toContain("'1': 'overview'");
    expect(desktop).toContain("'2': 'planning'");
    expect(desktop).toContain("'3': 'prepare'");
    expect(desktop).toContain("'4': 'settings'");
    expect(desktop).toContain("l: 'live'");
    expect(desktop).toContain("d: 'deck'");
  });

  it('keeps mobile instant commands globally one tap away', () => {
    expect(mobileHtml).toContain('id="command-trigger"');
    expect(mobile).toContain("commandTrigger.className = 'command-trigger'");
    expect(mobile).not.toContain('streamMenu?.append(commandTrigger)');
    expect(mobile).toContain("$('command-trigger').onclick");
  });

  it('keeps secondary mobile features within two taps without restoring visual clutter', () => {
    for (const target of ['sounds', 'prepare', 'settings']) expect(mobileHtml).toContain(`data-open-tab="${target}"`);
    for (const critical of ['quick-clip', 'live-clip', 'open-scenes-live', 'quick-mic']) {
      expect(mobileHtml).toContain(`id="${critical}"`);
    }
  });
});
