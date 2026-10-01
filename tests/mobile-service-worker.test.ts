import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mobile = readFileSync(new URL('../apps/mobile/mobile.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../apps/mobile/sw.js', import.meta.url), 'utf8');

describe('cache du shell mobile', () => {
  it('précharge chaque dépendance statique nécessaire au bootstrap hors ligne', () => {
    const imports = [...mobile.matchAll(/from ['"]\.\/(.+?)['"]/g)].map(match => match[1]);
    for (const dependency of imports) {
      expect(worker, `${dependency} absent du cache`).toContain(`'${dependency}'`);
      expect(worker, `${dependency} absent des routes cache-first`).toContain(`'/mobile/${dependency}'`);
    }
  });
});
