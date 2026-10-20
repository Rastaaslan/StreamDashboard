import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { extractFile, listPackage } from '@electron/asar';
const archive = path.resolve(process.argv[2] || 'out/StreamDashboard-win32-x64/resources/app.asar');
// ASAR uses host-native separators for lookup/listing, even for a Windows
// target packaged on another OS. Keep policy matching platform-independent.
const files = listPackage(archive).map(file => file.replaceAll('\\', '/'));
const readArchive = file => extractFile(archive, path.normalize(file));
assert.equal(JSON.parse(readArchive('package.json').toString()).version, JSON.parse(readFileSync('package.json','utf8')).version, 'Packaged runtime version must retain the complete release identifier');
const publicConfig = JSON.parse(readArchive('resources/distribution.json').toString());
assert.deepEqual(Object.keys(publicConfig).sort(), ['googleClientId', 'twitchClientId']);
assert.match(publicConfig.googleClientId, /^[\w.-]+\.apps\.googleusercontent\.com$/);
assert.ok(publicConfig.twitchClientId);
for (const file of files) {
  assert.ok(!/^\/(tests|test-results|docs|scripts|\.dependencies|\.cb52-tmp|\.git)(\/|$)/.test(file), `Unexpected packaged source: ${file}`);
  assert.ok(!/\.log$/.test(file), `Unexpected packaged log: ${file}`);
}
const lifecycle = readArchive('dist/apps/desktop/src/lifecycle.js').toString();
assert.match(lifecycle, /port: controller \? 48135 : 48133/);
for (const file of ['dist/apps/desktop/src/main.js', 'dist/apps/desktop/src/lifecycle.js', 'dist/apps/desktop/src/preload.cjs', 'apps/mobile/control/device-accounts.js', 'apps/mobile/control/device-bridge.js', 'apps/mobile/control/device-providers.js', 'apps/mobile/control/device-services.js', 'apps/mobile/control/local-planning.js', 'apps/mobile/shared/planning-engine.js', 'apps/mobile/control/device-workspace.js', 'apps/mobile/control/autonomy-store.js', 'apps/mobile/control/planning.js', 'apps/mobile/planning-export.js', 'apps/mobile/control/live-monitor.js', 'apps/mobile/control/control.js', 'apps/mobile/control/index.html', 'dist/apps/desktop/src/controller.js', 'apps/mobile/shared/planning-editor.js', 'apps/web/preview/preview.js', 'dist/integrations/obs/src/client.js']) {
  assert.deepEqual(readArchive(file), readFileSync(file), `Packaged asset diverges from source/build: ${file}`);
}
console.log('Desktop ASAR checked: public provider IDs, role ports, runtime assets and source/log exclusions.');
