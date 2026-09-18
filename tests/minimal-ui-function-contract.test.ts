import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const desktop = readFileSync(new URL('../apps/web/app.js', import.meta.url), 'utf8');
const mobileHtml = readFileSync(new URL('../apps/mobile/index.html', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../apps/mobile/mobile.js', import.meta.url), 'utf8');

describe('minimal UI feature contract', () => {
  it('preserves every critical desktop capability while reducing primary navigation', () => {
    for (const command of [
      'session.start', 'session.stop', 'timer.start', 'timer.pause', 'timer.reset', 'timer.add',
      'mode.set', 'obs.mute', 'obs.volumeDb', 'obs.media.restart', 'obs.browser.refresh',
    ]) expect(desktop).toContain(command);

    for (const action of [
      'open-event', 'export-planning', 'publish-planning-discord',
      'connect-twitch', 'disconnect-twitch', 'connect-google', 'disconnect-google',
      'test-obs', 'test-streamlabs', 'disconnect-streamlabs',
      'refresh-wizebot', 'disconnect-wizebot', 'create-pairing', 'revoke-device',
    ]) expect(desktop).toContain(action);

    for (const provider of ['OBS', 'Twitch', 'Discord', 'Streamlabs', 'WizeBot', 'Android']) {
      expect(desktop).toContain(provider);
    }
  });

  it('preserves every mobile workspace and critical live control', () => {
    for (const view of ['home', 'live', 'sounds', 'planning', 'prepare', 'settings', 'more']) {
      expect(mobileHtml).toContain(`data-view="${view}"`);
    }

    for (const id of [
      'stream', 'timer', 'quick-clip', 'live-clip', 'open-scenes', 'open-scenes-live',
      'home-mic', 'quick-mic', 'primary-soundboard', 'planning', 'checklist', 'notes',
      'templates', 'diagnostics', 'provider-accounts', 'command-palette',
    ]) expect(mobileHtml).toContain(`id="${id}"`);

    for (const mode of ['intro', 'live', 'pause', 'end']) expect(mobileHtml).toContain(`data-mode="${mode}"`);
    expect(mobileHtml).toContain('data-chatting');
    expect(mobileHtml).toContain('data-open-tab="sounds"');
    expect(mobile).toContain("if (tab === 'sounds') void loadSoundboard()");
  });
});
