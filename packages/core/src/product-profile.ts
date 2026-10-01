export const PROFILE_VERSION = 1 as const;
export type Theme = 'system' | 'light' | 'dark' | 'oled';
export type AppearancePreset = 'minimal' | 'soft' | 'compact' | 'contrast';
export type ModuleId = 'obs' | 'twitch' | 'planning' | 'notes' | 'checklist' | 'templates' | 'automations' | 'soundboard' | 'streamerPings' | 'googleCalendar' | 'discord' | 'streamlabs' | 'wizebot';
export interface ProductProfile {
  version: 1; profile: { displayName: string; channelName: string; language: string };
  modules: Record<ModuleId, boolean>;
  appearance: { theme: Theme; preset: AppearancePreset; accent: string; density: 'comfort' | 'normal' | 'compact'; radius: 'square' | 'medium' | 'round'; textScale: 'small' | 'normal' | 'large' };
  mobile: { notifications: boolean; haptics: boolean };
  providers: Record<'twitch' | 'google' | 'discord' | 'streamlabs' | 'wizebot', { mode: 'official' | 'custom' }>;
  onboarding: { completed: boolean };
  obs: { scenes: Array<{ label: string; scene: string }>; quickActions: Array<{ label: string; action: { type: string; [key: string]: unknown } }> };
}
export const defaultProductProfile = (): ProductProfile => ({ version: PROFILE_VERSION,
  profile: { displayName: 'Streamer', channelName: '', language: 'fr' },
  modules: { obs: true, twitch: true, planning: true, notes: true, checklist: true, templates: true, automations: true, soundboard: true, streamerPings: true, googleCalendar: false, discord: false, streamlabs: false, wizebot: false },
  appearance: { theme: 'system', preset: 'minimal', accent: '#2474e5', density: 'normal', radius: 'medium', textScale: 'normal' }, mobile: { notifications: true, haptics: true },
  providers: { twitch: { mode: 'official' }, google: { mode: 'official' }, discord: { mode: 'official' }, streamlabs: { mode: 'custom' }, wizebot: { mode: 'custom' } }, onboarding: { completed: false }, obs: { scenes: [], quickActions: [] } });
const forbidden = /(?:token|secret|password|credential|authorization|refreshToken|accessToken)/i;
export function assertSecretFree(value: unknown, at = 'profile'): void { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) { if (forbidden.test(key)) throw new Error(`Le profil ne peut pas contenir de secret (${at}.${key}).`); assertSecretFree(child, `${at}.${key}`); } }
const plainObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function validateProductProfile(value: unknown): ProductProfile {
  if (!plainObject(value)) throw new Error('Profil invalide.'); if (value.version !== 1) throw new Error(`Version de profil non prise en charge: ${String(value.version)}.`); assertSecretFree(value);
  const result = structuredClone(defaultProductProfile());
  for (const key of ['profile','modules','appearance','mobile','providers','onboarding','obs'] as const) if (plainObject(value[key])) Object.assign(result[key], value[key]);
  for (const id of Object.keys(result.modules) as ModuleId[]) if (typeof result.modules[id] !== 'boolean') throw new Error(`Module invalide: ${id}.`);
  if (!/^#[0-9a-f]{6}$/i.test(result.appearance.accent)) throw new Error('La couleur principale doit utiliser le format #RRGGBB.');
  if (!['system','light','dark','oled'].includes(result.appearance.theme)) throw new Error('Thème invalide.');
  const dependencies: Partial<Record<ModuleId, ModuleId[]>> = { soundboard: ['obs'], streamerPings: ['twitch'], googleCalendar: ['planning'] };
  for (const [id, required] of Object.entries(dependencies) as Array<[ModuleId, ModuleId[]]>) if (result.modules[id]) for (const dependency of required) if (!result.modules[dependency]) throw new Error(`${id} nécessite le module ${dependency}.`);
  return result;
}
const scalar = (value: string): unknown => { const text = value.trim(); if (text === 'true' || text === 'false') return text === 'true'; if (text === 'null') return null; if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text); if (text.startsWith('\"') || text.startsWith('[') || text.startsWith('{')) return JSON.parse(text); return text; };
/** Strict, alias-free YAML subset used by the versioned profile schema. */
export function parseProfileYaml(source: string): unknown {
  if (/^\t/m.test(source) || /(?:^|\s)[&*!][A-Za-z]/m.test(source) || /<<\s*:/.test(source)) throw new Error('Fonction YAML avancée non autorisée.');
  const root: Record<string, unknown> = {}; const stack: Array<{ indent: number; value: Record<string, unknown> }> = [{ indent: -1, value: root }];
  for (const [index, raw] of source.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) { if (!raw.trim() || raw.trimStart().startsWith('#')) continue; const indent = raw.length - raw.trimStart().length; if (indent % 2) throw new Error(`Indentation invalide ligne ${index + 1}.`); const match = raw.trim().match(/^([A-Za-z][A-Za-z0-9]*):(?:\s+(.*))?$/); if (!match) throw new Error(`YAML invalide ligne ${index + 1}.`); while (stack.at(-1)!.indent >= indent) stack.pop(); const parent = stack.at(-1)!.value; if (Object.hasOwn(parent, match[1])) throw new Error(`Clé dupliquée: ${match[1]}.`); if (match[2] === undefined) { const child = {}; parent[match[1]] = child; stack.push({ indent, value: child }); } else parent[match[1]] = scalar(match[2]); }
  return root;
}
const quote = (value: unknown) => typeof value === 'string' ? JSON.stringify(value) : String(value);
function yamlLines(value: Record<string, unknown>, indent = 0): string[] { return Object.entries(value).flatMap(([key, child]) => plainObject(child) ? [`${' '.repeat(indent)}${key}:`, ...yamlLines(child, indent + 2)] : Array.isArray(child) ? [`${' '.repeat(indent)}${key}: ${JSON.stringify(child)}`] : [`${' '.repeat(indent)}${key}: ${quote(child)}`]); }
export const exportProductProfile = (profile: ProductProfile): string => `${yamlLines(validateProductProfile(profile) as unknown as Record<string, unknown>).join('\n')}\n`;
export const importProductProfile = (source: string): ProductProfile => { try { return migrateProductProfile(parseProfileYaml(source)); } catch (error) { throw new Error(`Import impossible: ${error instanceof Error ? error.message : 'format invalide'}`); } };
export function migrateProductProfile(value: unknown): ProductProfile {
  if (plainObject(value) && value.version === 1) return validateProductProfile(value);
  if (plainObject(value) && value.version === 0) { const migrated = defaultProductProfile(); if (plainObject(value.profile)) Object.assign(migrated.profile, value.profile); if (plainObject(value.modules)) Object.assign(migrated.modules, value.modules); if (plainObject(value.appearance)) Object.assign(migrated.appearance, value.appearance); return validateProductProfile(migrated); }
  throw new Error('Aucune migration disponible pour ce profil.');
}
