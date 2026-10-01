import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
const copyScript = readFileSync(new URL('../scripts/copy-runtime-js.mjs', import.meta.url), 'utf8');

describe('desktop runtime assets', () => {
  it('copies recurrence runtime JavaScript after TypeScript compilation', () => {
    expect(packageJson.scripts.build).toContain('node scripts/copy-runtime-js.mjs');
    expect(copyScript).toContain("'packages/core/src/recurrence.js'");
    expect(copyScript).toContain("'apps/mobile/shared/recurrence.js'");
    expect(existsSync(new URL('../packages/core/src/recurrence.js', import.meta.url))).toBe(true);
    expect(existsSync(new URL('../apps/mobile/shared/recurrence.js', import.meta.url))).toBe(true);
  });
});
