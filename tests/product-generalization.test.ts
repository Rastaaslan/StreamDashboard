import { describe, expect, it, vi } from 'vitest';
import { assertSecretFree, defaultProductProfile, exportProductProfile, importProductProfile, validateProductProfile } from '../packages/core/src/product-profile.js';
import { resolveModules, setModule } from '../packages/core/src/module-registry.js';
import { ConnectionRegistry, connectionStatusLabels, type ConnectionProvider } from '../packages/core/src/connection-provider.js';
describe('profil StreamDashboard', () => {
  it('round-trip le profil versionné sans secret', () => { const initial = defaultProductProfile(); const result = importProductProfile(exportProductProfile(initial)); expect(result).toEqual(initial); expect(result.version).toBe(1); });
  it('rejette corruption, versions futures et secrets imbriqués', () => { expect(() => importProductProfile('{')).toThrow(/Import impossible/); expect(() => validateProductProfile({ version: 2 })).toThrow(/Version/); expect(() => assertSecretFree({ obs: { password: 'nope' } })).toThrow(/secret/i); });
  it('valide les couleurs', () => { const profile = defaultProductProfile(); profile.appearance.accent = 'red'; expect(() => validateProductProfile(profile)).toThrow(/#RRGGBB/); });
});
describe('modules produit', () => {
  it('active les dépendances et masque les modules dépendants désactivés', () => { let profile = defaultProductProfile(); profile = setModule(profile, 'twitch', false); expect(profile.modules.streamerPings).toBe(false); profile = setModule(profile, 'streamerPings', true); expect(profile.modules.twitch).toBe(true); expect(resolveModules(profile).find(item => item.id === 'streamerPings')?.blockedBy).toEqual([]); });
});
describe('connexions unifiées', () => {
  it('expose le contrat et les libellés communs', async () => { const provider: ConnectionProvider = { id: 'obs', label: 'OBS', capabilities: ['test'], connect: vi.fn(), disconnect: vi.fn(), test: vi.fn(), refresh: vi.fn(), requiresReauth: vi.fn(async () => false), getStatus: vi.fn(async () => ({ id: 'obs', label: 'OBS', status: 'connected', mode: 'official', capabilities: ['test'], requiresReauth: false })) }; const registry = new ConnectionRegistry().register(provider); expect((await registry.statuses())[0].status).toBe('connected'); expect(connectionStatusLabels['reauth-required']).toBe('Autorisation nécessaire'); expect(() => registry.register(provider)).toThrow(/déjà/); });
});
