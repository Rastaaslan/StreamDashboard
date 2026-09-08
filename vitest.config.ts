import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['_integration_sources/**', 'node_modules/**', 'dist/**'],
  },
});
