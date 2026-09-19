import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: ['electron.smoke.spec.ts', 'desktop-preview.spec.ts', 'mobile.bootstrap.spec.ts', 'mobile-preview-live.spec.ts'],
  timeout: 45_000,
  workers: 1,
  reporter: 'line',
});
