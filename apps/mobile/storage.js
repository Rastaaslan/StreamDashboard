import { isAndroidRuntime } from './runtime.js';

const SERVER_KEY = 'streamdashboard.server';
const DEVICE_KEY = 'streamdashboard.device';
let activeCredential = '';

export const settingsStorage = {
  getServer: () => localStorage.getItem(SERVER_KEY) || '',
  setServer(value) { value ? localStorage.setItem(SERVER_KEY, value) : localStorage.removeItem(SERVER_KEY); },
};

export const credentialStorage = {
  async get() {
    if (activeCredential) return activeCredential;
    activeCredential = isAndroidRuntime()
      ? globalThis.StreamDashboardNative.getCredential() || ''
      : localStorage.getItem(DEVICE_KEY) || '';
    return activeCredential;
  },
  async set(value) {
    const next = String(value || '');
    if (isAndroidRuntime()) {
      // Older native versions return void; current versions acknowledge the
      // durable encrypted write. Never cache a rejected pairing credential.
      if (globalThis.StreamDashboardNative.setCredential(next) === false) throw new Error('Enregistrement sécurisé impossible. La connexion précédente est conservée.');
    } else localStorage.setItem(DEVICE_KEY, next);
    activeCredential = next;
  },
  async clear() {
    if (isAndroidRuntime()) {
      if (globalThis.StreamDashboardNative.clearCredential() === false) throw new Error('Impossible d’effacer la connexion enregistrée. Réessayez.');
    } else localStorage.removeItem(DEVICE_KEY);
    activeCredential = '';
  },
};
