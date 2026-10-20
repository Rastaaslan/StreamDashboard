import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('credential mobile de session', () => {
  it('réutilise immédiatement le credential fraîchement appairé au lieu de relire une ancienne valeur native', async () => {
    const native = {
      isAndroid: () => true,
      getCredential: vi.fn(() => 'credential-before-pairing'),
      setCredential: vi.fn(),
      clearCredential: vi.fn(),
    };
    vi.stubGlobal('StreamDashboardNative', native);
    const { credentialStorage } = await import('../apps/mobile/storage.js');

    expect(await credentialStorage.get()).toBe('credential-before-pairing');
    await credentialStorage.set('credential-freshly-paired');

    native.getCredential.mockReturnValue('stale-native-value');
    expect(await credentialStorage.get()).toBe('credential-freshly-paired');
    expect(native.getCredential).toHaveBeenCalledTimes(1);
    expect(native.setCredential).toHaveBeenCalledWith('credential-freshly-paired');
  });

  it('conserve la session précédente si le stockage natif refuse l’écriture ou la suppression', async () => {
    const native = {
      isAndroid: () => true,
      getCredential: vi.fn(() => 'previous-credential'),
      setCredential: vi.fn(() => false),
      clearCredential: vi.fn(() => false),
    };
    vi.stubGlobal('StreamDashboardNative', native);
    const { credentialStorage } = await import('../apps/mobile/storage.js');
    expect(await credentialStorage.get()).toBe('previous-credential');
    await expect(credentialStorage.set('unpersisted-credential')).rejects.toThrow('Enregistrement sécurisé impossible');
    expect(await credentialStorage.get()).toBe('previous-credential');
    await expect(credentialStorage.clear()).rejects.toThrow('Impossible d’effacer');
    expect(await credentialStorage.get()).toBe('previous-credential');
    native.setCredential.mockReturnValue(true);
    await credentialStorage.set('persisted-credential');
    expect(await credentialStorage.get()).toBe('persisted-credential');
  });

  it('ne remplace pas le cache si localStorage est plein et reste cohérent après une suppression réussie', async () => {
    let value = 'browser-credential';
    const storage = {
      getItem: vi.fn(() => value),
      setItem: vi.fn(() => { throw new Error('QuotaExceededError'); }),
      removeItem: vi.fn(() => { value = ''; }),
    };
    vi.stubGlobal('localStorage', storage);
    const { credentialStorage } = await import('../apps/mobile/storage.js');
    expect(await credentialStorage.get()).toBe('browser-credential');
    await expect(credentialStorage.set('unpersisted-browser-credential')).rejects.toThrow('QuotaExceededError');
    expect(await credentialStorage.get()).toBe('browser-credential');
    await credentialStorage.clear();
    expect(await credentialStorage.get()).toBe('');
  });
});
