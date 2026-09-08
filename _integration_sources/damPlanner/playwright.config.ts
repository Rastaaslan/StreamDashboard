import { defineConfig } from '@playwright/test';

const rendererUrl = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: rendererUrl },
  webServer: {
    command: 'pnpm run dev:e2e',
    url: rendererUrl,
    reuseExistingServer: false,
  },
});
