import { isAndroidRuntime } from './runtime.js';

const SERVER_KEY = 'streamdashboard.server';
const DEVICE_KEY = 'streamdashboard.device';

export const settingsStorage = {
  getServer: () => localStorage.getItem(SERVER_KEY) || '',
  setServer(value) { value ? localStorage.setItem(SERVER_KEY, value) : localStorage.removeItem(SERVER_KEY); },
};

export const credentialStorage = {
  async get() {
    if (isAndroidRuntime()) return globalThis.StreamDashboardNative.getCredential() || '';
    return localStorage.getItem(DEVICE_KEY) || '';
  },
  async set(value) {
    if (isAndroidRuntime()) globalThis.StreamDashboardNative.setCredential(value);
    else localStorage.setItem(DEVICE_KEY, value);
  },
  async clear() {
    if (isAndroidRuntime()) globalThis.StreamDashboardNative.clearCredential();
    else localStorage.removeItem(DEVICE_KEY);
  },
};
