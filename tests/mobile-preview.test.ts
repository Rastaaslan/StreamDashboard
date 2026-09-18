import { describe, expect, it } from 'vitest';
import { devFixtureName } from '../apps/mobile/dev-fixtures.js';

describe('Android preview fixture', () => {
  it('autorise les fixtures sur l’origine WebViewAssetLoader', () => {
    expect(devFixtureName({
      hostname: 'appassets.androidplatform.net',
      search: '?fixture=live&preview=1',
    })).toBe('live');
  });

  it('refuse les fixtures sur une origine réseau arbitraire', () => {
    expect(devFixtureName({
      hostname: '192.168.1.20',
      search: '?fixture=live&preview=1',
    })).toBeNull();
  });
});
