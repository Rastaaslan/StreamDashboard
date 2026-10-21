import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: ['planning-transfer-ui.spec.ts', 'sound-transfer-ui.spec.ts', 'replica-identity-ui.spec.ts', 'installation-ui.spec.ts', 'mobile-network-ui.spec.ts', 'streamlabs-feed-ui.spec.ts', 'live-monitor-chat-ui.spec.ts', 'live-layout-ui.spec.ts', 'mobile-activity-ui.spec.ts', 'mobile-local-ui.spec.ts', 'controller-bindings-ui.spec.ts'],
  timeout: 30_000,
  workers: 1,
  use: { headless: true, serviceWorkers: 'block', screenshot: 'only-on-failure' },
});
