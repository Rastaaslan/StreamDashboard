import assert from 'node:assert/strict';
import path from 'node:path';
import { extractFile, listPackage } from '@electron/asar';
const archive = path.resolve(process.argv[2] || 'out/StreamDashboard-win32-x64/resources/app.asar');
const files = listPackage(archive);
const publicConfig = JSON.parse(extractFile(archive, 'resources/distribution.json').toString());
assert.deepEqual(Object.keys(publicConfig).sort(), ['googleClientId', 'twitchClientId']);
assert.match(publicConfig.googleClientId, /^[\w.-]+\.apps\.googleusercontent\.com$/);
assert.ok(publicConfig.twitchClientId);
for (const file of files) {
  assert.ok(!/^\/(tests|test-results|docs|scripts|\.dependencies|\.git)(\/|$)/.test(file), `Unexpected packaged source: ${file}`);
  assert.ok(!/\.log$/.test(file), `Unexpected packaged log: ${file}`);
}
const lifecycle = extractFile(archive, 'dist/apps/desktop/src/lifecycle.js').toString();
assert.match(lifecycle, /port: 48132/);
for (const file of ['apps/mobile/shared/planning-editor.js', 'apps/web/preview/preview.js', 'dist/integrations/obs/src/client.js']) {
  assert.ok(extractFile(archive, file).length, `Missing runtime asset: ${file}`);
}
console.log('Desktop ASAR checked: public provider IDs, fixed port, runtime assets and source/log exclusions.');
