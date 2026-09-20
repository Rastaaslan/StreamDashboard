import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { devFixtureName } from '../apps/mobile/dev-fixtures.js';

describe('Android preview', () => {
  it('autorise les fixtures sur l’origine WebViewAssetLoader', () => {
    expect(devFixtureName({ hostname: 'appassets.androidplatform.net', search: '?fixture=live&preview=1' })).toBe('live');
  });

  it('promote la V2 comme UI Android release tout en gardant le mode preview', () => {
    const activity = readFileSync('android/app/src/main/java/com/rastaaslan/streamdashboard/remote/MainActivity.java', 'utf8');
    const preview = readFileSync('apps/mobile/preview.html', 'utf8');
    const previewScript = readFileSync('apps/mobile/preview.js', 'utf8');
    expect(activity).toContain('"/mobile/index.html"');
    for (const target of ['data-nav="home"', 'data-nav="live"', 'data-nav="sounds"', 'data-nav="planning"']) expect(preview).toContain(target);
    expect(preview).toContain('APERÇU • UI V2');
    expect(previewScript).toContain("get('runtime') === '1'");
    expect(previewScript).toContain("$('#preview-badge')?.remove()");
    expect(preview).toContain('id="streamer-ping-dialog"');
    expect(previewScript).toContain('notifyStreamerPing');
    expect(preview).toContain('Outils avancés');
    expect(previewScript).toContain("location.href = './index.html?legacy=1'");
    for (const scene of ['Intro', 'Gameplay', 'Chatting', 'Pause', 'Fin']) expect(preview).toContain(`data-scene="${scene}"`);
    expect(preview).toContain('id="add-quick-sound"');
    expect(preview).toContain('id="quick-sound-categories"');
  });

  it('nettoie complètement la release des valeurs de maquette et de l’ancien appairage', () => {
    const preview = readFileSync('apps/mobile/preview.html', 'utf8');
    const previewScript = readFileSync('apps/mobile/preview.js', 'utf8');
    const legacy = readFileSync('apps/mobile/index.html', 'utf8');
    const legacyScript = readFileSync('apps/mobile/mobile.js', 'utf8');

    for (const sample of ['In Sound Mind', 'Mimi', 'Fred', 'BONK', 'CREEPER', 'VICTOIRE', 'FC 26 · FC Peace', 'Polymatheia', '02:14:32']) {
      expect(preview).not.toContain(sample);
    }
    expect(preview).toContain('Aucun live en cours');
    expect(preview).toContain('PC non appairé');
    expect(previewScript).toContain("productionUi ? 'streamdashboard.quickSoundSelections' : 'streamdashboard.preview.quickSoundSelections'");
    expect(legacy).not.toContain('data-settings-target="pairing"');
    expect(legacyScript).toContain('openCanonicalPairing');
    expect(legacyScript).toContain("localStorage.setItem('streamdashboard.pendingPairing'");
    expect(previewScript).toContain("localStorage.getItem('streamdashboard.pendingPairing')");
  });
});
