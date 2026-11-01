// Reproducible browser artifact: no independent client context algorithm.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
export async function contextBrowserSource() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../../../packages/core/src/streamcockpit-context.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    banner: { js: '// Generated from packages/core/src/streamcockpit-context.ts. Do not edit.\n// Regenerate: node apps/mobile/control/streamcockpit-context-build.mjs' },
  });
  return result.outputFiles[0].text;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('./streamcockpit-context-core.js', import.meta.url), await contextBrowserSource());
}
