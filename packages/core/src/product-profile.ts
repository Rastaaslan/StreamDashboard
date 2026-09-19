export const PROFILE_VERSION = 1 as const;

export type Theme = 'system' | 'light' | 'dark' | 'oled';
export type AppearancePreset = 'minimal' | 'soft' | 'compact' | 'contrast';
export type ModuleId = 'obs' | 'twitch' | 'planning' | 'notes' | 'checklist' | 'templates' | 'automations' | 'soundboard' | 'streamerPings' | 'googleCalendar' | 'discord' | 'streamlabs' | 'wizebot';
export interface ProductProfile {
  version: 1;
  profile: { displayName: string; channelName: string; language: string };
  modules: Record<ModuleId, boolean>;
  appearance: { theme: Theme; preset: AppearancePreset; accent: string; density: 'comfort' | 'normal' | 'compact'; radius: 'square' | 'medium' | 'round'; textScale: 'small' | 'normal' | 'large' };
  mobile: { notifications: boolean; haptics: boolean };
  obs: { scenes: Array<{ label: string; scene: string }>; quickActions: Array<{ label: string; action: { type: string; [key: string]: unknown } }> };
}
export const defaultProductProfile = (): ProductProfile => ({
  version: PROFILE_VERSION,
  profile: { displayName: 'Streamer', channelName: '', language: 'fr' },
  modules: { obs: true, twitch: true, planning: true, notes: true, checklist: true, templates: true, automations: true, soundboard: true, streamerPings: true, googleCalendar: false, discord: false, streamlabs: false, wizebot: false },
  appearance: { theme: 'system', preset: 'minimal', accent: '#2474e5', density: 'normal', radius: 'medium', textScale: 'normal' },
  mobile: { notifications: true, haptics: true }, obs: { scenes: [], quickActions: [] },
});
const forbidden = /(?:token|secret|password|credential|authorization|refreshToken|accessToken)/i;
export function assertSecretFree(value: unknown, path = 'profile'): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) { if (forbidden.test(key)) throw new Error(`Le profil ne peut pas contenir de secret (${path}.${key}).`); assertSecretFree(child, `${path}.${key}`); }
}
export function validateProductProfile(value: unknown): ProductProfile {
  if (!value || typeof value !== 'object') throw new Error('Profil invalide.');
  const candidate = value as Partial<ProductProfile>; if (candidate.version !== 1) throw new Error(`Version de profil non prise en charge: ${String(candidate.version)}.`);
  const merged = structuredClone(defaultProductProfile()); Object.assign(merged.profile, candidate.profile); Object.assign(merged.modules, candidate.modules); Object.assign(merged.appearance, candidate.appearance); Object.assign(merged.mobile, candidate.mobile); Object.assign(merged.obs, candidate.obs);
  if (!/^#[0-9a-f]{6}$/i.test(merged.appearance.accent)) throw new Error('La couleur principale doit utiliser le format #RRGGBB.');
  assertSecretFree(candidate); return merged;
}
/** JSON is a strict YAML subset, keeping imports dependency-free and unambiguous. */
export const exportProductProfile = (profile: ProductProfile): string => { const safe = validateProductProfile(profile); return `${JSON.stringify(safe, null, 2)}\n`; };
export const importProductProfile = (source: string): ProductProfile => { try { return validateProductProfile(JSON.parse(source)); } catch (error) { throw new Error(`Import impossible: ${error instanceof Error ? error.message : 'format invalide'}`); } };
