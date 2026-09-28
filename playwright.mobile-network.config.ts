import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'mobile-network-ui.spec.ts',
  timeout: 30_000,
  workers: 1,
  use: { headless: true, serviceWorkers: 'block' },
});
