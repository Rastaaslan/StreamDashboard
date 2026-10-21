import { build } from 'esbuild';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
const licenses=await Promise.all(['crypto-js','entities'].map(async name=>'Third-party dependency: '+name+'\n'+await readFile('node_modules/'+name+'/LICENSE','utf8')));

// Ship the production orchestrator on Android, including the exact same series
// reconciliation and identity rules. No second mobile planning implementation.
await build({
  stdin: { contents: `export { PlanningOrchestrator } from './packages/core/src/planning.ts';
    export { createHash as createIdentityHash, createBinaryHash } from './scripts/mobile-hash-shim.js';
    export { randomUuid } from './packages/core/src/uuid.ts';
    export { defaultProductProfile, validateProductProfile } from './packages/core/src/product-profile.ts';
    export { parseWizeBotCatalog } from './integrations/wizebot/src/catalog.ts';
    export { normalizeStreamlabsHistory, mergeStreamlabsHistory } from './integrations/streamlabs/src/history.ts';
    export { generateTwitchTags } from './packages/core/src/twitch-tags.ts';
    export { googleRecurrence, parseGoogleRecurrence } from './integrations/google-calendar/src/recurrence.ts';`,
    resolveDir: process.cwd(), sourcefile: 'mobile-planning-entry.js' },
  // Keep bundle module names stable when a worktree shares node_modules.
  preserveSymlinks: true,
  outfile: 'apps/mobile/shared/planning-engine.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  external: ['crypto'], legalComments: 'eof', banner:{js:'/*!\n'+licenses.join('\n\n')+'\n*/'},
  plugins: [{ name: 'browser-planning-platform', setup(builder) {
    builder.onResolve({ filter: /^node:crypto$/ }, () => ({ path: path.resolve('scripts/mobile-hash-shim.js') }));
    builder.onResolve({ filter: /sync-performance\.js$/ }, () => ({ path: path.resolve('scripts/mobile-sync-shim.js') }));
  } }],
});
