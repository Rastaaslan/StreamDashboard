import { describe, expect, it, vi } from 'vitest';
import { credentialStorage } from '../apps/mobile/storage.js';

describe('credential mobile de session', () => {
  it('réutilise immédiatement le credential fraîchement appairé au lieu de relire une ancienne valeur native', async () => {
    const native = {
      isAndroid: () => true,
      getCredential: vi.fn(() => 'credential-before-pairing'),
      setCredential: vi.fn(),
      clearCredential: vi.fn(),
    };
    vi.stubGlobal('StreamDashboardNative', native);

    expect(await credentialStorage.get()).toBe('credential-before-pairing');
    await credentialStorage.set('credential-freshly-paired');

    native.getCredential.mockReturnValue('stale-native-value');
    expect(await credentialStorage.get()).toBe('credential-freshly-paired');
    expect(native.getCredential).toHaveBeenCalledTimes(1);
    expect(native.setCredential).toHaveBeenCalledWith('credential-freshly-paired');
  });
});
