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
    activeCredential = String(value || '');
    if (isAndroidRuntime()) globalThis.StreamDashboardNative.setCredential(activeCredential);
    else localStorage.setItem(DEVICE_KEY, activeCredential);
  },
  async clear() {
    activeCredential = '';
    if (isAndroidRuntime()) globalThis.StreamDashboardNative.clearCredential();
    else localStorage.removeItem(DEVICE_KEY);
  },
};
