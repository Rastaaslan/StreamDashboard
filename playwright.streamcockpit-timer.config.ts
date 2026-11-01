import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests',
  testMatch:['controller-bindings-ui.spec.ts'],
  timeout:30_000,
  workers:1,
  use:{headless:true,serviceWorkers:'block'},
});
