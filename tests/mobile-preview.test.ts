import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { devFixtureName } from '../apps/mobile/dev-fixtures.js';

describe('Android preview', () => {
  it('autorise les fixtures sur l’origine WebViewAssetLoader', () => {
    expect(devFixtureName({ hostname: 'appassets.androidplatform.net', search: '?fixture=live&preview=1' })).toBe('live');
  });

  it('garde une UI preview réellement séparée de l’interface de production', () => {
    const activity = readFileSync('android/app/src/main/java/com/rastaaslan/streamdashboard/remote/MainActivity.java', 'utf8');
    const preview = readFileSync('apps/mobile/preview.html', 'utf8');
    expect(activity).toContain('BuildConfig.PREVIEW_MODE ? "/mobile/preview.html" : "/mobile/index.html"');
    for (const target of ['data-nav="home"', 'data-nav="live"', 'data-nav="sounds"', 'data-nav="planning"']) {
      expect(preview).toContain(target);
    }
    expect(preview).toContain('APERÇU • AUCUNE COMMANDE RÉELLE');
    for (const scene of ['Intro', 'Gameplay', 'Chatting', 'Pause', 'Fin']) {
      expect(preview).toContain(`data-scene="${scene}"`);
    }
    expect(preview).toContain('id="add-quick-sound"');
    expect(preview).toContain('id="quick-sound-categories"');
  });
});
