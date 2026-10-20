import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: ['mobile-network-ui.spec.ts', 'streamlabs-feed-ui.spec.ts', 'live-monitor-chat-ui.spec.ts', 'live-layout-ui.spec.ts', 'mobile-activity-ui.spec.ts', 'controller-bindings-ui.spec.ts'],
  timeout: 30_000,
  workers: 1,
  use: { headless: true, serviceWorkers: 'block', screenshot: 'only-on-failure' },
});
