import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: 'electron.smoke.spec.ts', timeout: 45_000, workers: 1, reporter: 'line' });
