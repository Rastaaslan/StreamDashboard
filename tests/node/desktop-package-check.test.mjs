import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const filesystemPath = require.resolve('@electron/asar/lib/filesystem.js');
const asarRequire = createRequire(filesystemPath);
const checker = readFileSync(new URL('../../scripts/check-desktop-package.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');
const sourceManifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const { devDependencies: _development, ...runtimeManifest } = sourceManifest;
// Explicit release fixture: source/build and packaged contents are separate so
// a stale or missing required asset cannot satisfy the comparison by construction.
const runtimeAssets = [
  'dist/apps/desktop/src/main.js', 'dist/apps/desktop/src/lifecycle.js', 'dist/apps/desktop/src/preload.cjs',
  'dist/apps/desktop/src/security.js', 'dist/apps/desktop/src/controller.js',
  'dist/apps/desktop/src/restart-safety.js', 'dist/apps/desktop/src/updater.js',
  'dist/apps/desktop/src/window.js', 'dist/apps/mobile/runtime.js',
  'apps/mobile/runtime.js', 'apps/mobile/control/controller-bindings.js',
  'dist/apps/desktop/src/twitch-viewer.js', 'apps/mobile/control/twitch-category-picker.js',
  'dist/integrations/twitch/src/metadata.js', 'dist/integrations/obs/src/output-result.js',
  'dist/apps/server/src/replay-auto-start.js',
  'dist/apps/server/src/restart-safety.js', 'dist/apps/server/src/twitch-metadata-route.js',
  'apps/mobile/control/device-accounts.js', 'apps/mobile/control/device-bridge.js',
  'apps/mobile/control/device-providers.js', 'apps/mobile/control/device-services.js',
  'apps/mobile/control/device-audio.js', 'apps/mobile/control/device-streamlabs.js',
  'apps/mobile/control/performance-ui.js', 'apps/mobile/control/performance.css',
  'apps/mobile/control-fonts.css', 'apps/mobile/sw.js', 'apps/mobile/storage.js',
  'apps/mobile/control/local-planning.js', 'apps/mobile/shared/planning-engine.js',
  'apps/mobile/control/device-workspace.js', 'apps/mobile/control/autonomy-store.js',
  'apps/mobile/control/planning.js', 'apps/mobile/planning-export.js',
  'apps/mobile/control/live-monitor.js', 'apps/mobile/control/live-controls.js',
  'apps/mobile/control/youtube-picker.js', 'apps/mobile/control/twitch-chat.js',
  'apps/mobile/control/twitch-chat.css', 'apps/mobile/control/streamlabs-feed.js',
  'apps/mobile/control/control.js', 'apps/mobile/control/control.css', 'apps/mobile/control/index.html',
  'apps/mobile/shared/planning-editor.js', 'apps/web/preview/preview.js',
  'dist/apps/server/src/twitch-chat-routes.js', 'dist/apps/server/src/control-routes.js',
  'dist/apps/server/src/control-service.js', 'dist/integrations/youtube/src/client.js',
  'dist/apps/server/src/streamlabs-feed.js', 'dist/integrations/streamlabs/src/events.js',
  'dist/apps/server/src/streamlabs-history.js', 'dist/integrations/streamlabs/src/history.js',
  'dist/apps/server/src/index.js', 'dist/apps/server/src/storage.js',
  'dist/apps/server/src/remote-api-policy.js', 'dist/apps/server/src/live-control-routes.js',
  'dist/apps/desktop/src/secrets.js', 'dist/integrations/obs/src/client.js',
];
const fixture = {
  ...Object.fromEntries(runtimeAssets.map(file => [file, `runtime asset: ${file}`])),
  'package.json': JSON.stringify(runtimeManifest),
  'resources/distribution.json': JSON.stringify({ googleClientId: 'public.apps.googleusercontent.com', twitchClientId: 'public' }),
  'dist/apps/desktop/src/lifecycle.js': 'startDashboardServer({ port: controller ? 48135 : 48133 });',
};

// Use ASAR's actual Filesystem implementation with POSIX and Windows path
// semantics, without changing Node's global path module or skipping an OS.
function filesystem(platform, entries) {
  const exports = {};
  vm.runInNewContext(readFileSync(filesystemPath, 'utf8'), {
    exports, require: name => name === 'path' ? platform : asarRequire(name), Buffer,
  }, { filename: filesystemPath });
  const fs = new exports.Filesystem('.');
  const header = { files: {} };
  for (const [file, content] of Object.entries(entries)) {
    const parts = file.split('/'); const basename = parts.pop(); let node = header;
    for (const part of parts) node = node.files[part] ||= { files: {} };
    node.files[basename] = { size: Buffer.byteLength(content), offset: '0' };
  }
  fs.setHeader(header, 0);
  return { fs, headerString: JSON.stringify(header) };
}
function check(platform, changes = {}, options = {}) {
  const entries = { ...fixture, ...changes };
  for (const file of Object.keys(entries)) if (entries[file] === null) delete entries[file];
  const { fs, headerString } = filesystem(platform, entries);
  const archive = platform.resolve('out/StreamDashboard-win32-x64/resources/app.asar');
  const executable = platform.join(platform.dirname(platform.dirname(archive)), 'StreamDashboard.exe');
  const executableBytes = Buffer.from('portable executable fixture');
  const integrity = [{ file: 'resources\\app.asar', alg: 'SHA256', value: createHash('sha256').update(headerString).digest('hex') }];
  const resources = [{ type: 'INTEGRITY', id: 'ELECTRONASAR', bin: Buffer.from(JSON.stringify(options.integrity?.(integrity) ?? integrity)) }];
  const pe = { is32bit: () => options.is32bit === true };
  vm.runInNewContext(options.script ?? checker, {
    assert, path: platform, Buffer, createHash,
    process: { argv: ['node', 'checker', archive] }, console: { log() {} },
    listPackage: () => fs.listFiles(),
    extractFile: (_archive, file) => {
      fs.getFile(file); // Real ASAR lookup: unnormalized nested paths fail on Windows.
      return Buffer.from(entries[file.replaceAll('\\', '/')]);
    },
    readFileSync: file => {
      if (file === executable) return executableBytes;
      const normalized = file.replaceAll('\\', '/');
      return Buffer.from(normalized === 'package.json' ? JSON.stringify(sourceManifest) : fixture[normalized]);
    },
    // The checker consumes these parser boundaries; its path, architecture and
    // resource/hash comparisons execute unchanged against the supplied data.
    NtExecutable: { from: (bytes, settings) => {
      assert.deepEqual(bytes, executableBytes);
      assert.equal(settings.ignoreCert, true);
      return pe;
    } },
    NtExecutableResource: { from: value => {
      assert.equal(value, pe);
      return { entries: options.resources?.(resources) ?? resources };
    } },
    getRawHeader: file => {
      assert.equal(file, archive);
      return { headerString: options.headerString ?? headerString };
    },
  }, { filename: 'check-desktop-package.mjs' });
}

test('reproduces the old ASAR Windows lookup failure with the existing nested lifecycle layout', () => {
  assert.throws(() => check(path.win32, {}, { script: checker.replace('path.normalize(file)', 'file') }), /lifecycle\.js.*was not found/);
});
for (const platform of [path.posix, path.win32]) {
  const name = platform === path.win32 ? 'Windows' : 'POSIX';
  test(`${name}: package checker reads nested runtime assets`, () => check(platform));
  test(`${name}: package checker retains security, port and source/asset invariants`, () => {
    assert.throws(() => check(platform, { 'dist/apps/desktop/src/lifecycle.js': null }), /was not found/);
    for (const ports of ['port: 48132', 'port: controller ? 48134 : 48133', 'port: controller ? 48135 : 48132']) {
      assert.throws(() => check(platform, { 'dist/apps/desktop/src/lifecycle.js': ports }), /48135.*48133/);
    }
    assert.throws(() => check(platform, { 'resources/distribution.json': JSON.stringify({ googleClientId: 'public.apps.googleusercontent.com', twitchClientId: 'public', googleClientSecret: 'private' }) }), /googleClientSecret/);
    for (const file of runtimeAssets.filter(file => !file.endsWith('/lifecycle.js'))) {
      assert.throws(() => check(platform, { [file]: 'stale build' }), /Packaged asset diverges/);
    }
    // A stale lifecycle which retains valid role ports must also fail equality.
    assert.throws(() => check(platform, { 'dist/apps/desktop/src/lifecycle.js': fixture['dist/apps/desktop/src/lifecycle.js'] + '\n// stale build' }), /Packaged asset diverges/);
    for (const directory of ['tests','test-results','docs','scripts','data','config','logs','.dependencies','.cb52-tmp','.git']) {
      assert.throws(() => check(platform, { [`${directory}/unexpected.txt`]: 'excluded' }), /Unexpected packaged source/);
    }
    assert.throws(() => check(platform, { 'runtime.log': 'private' }), /Unexpected packaged log/);
    for (const file of ['.env', 'apps/.env.local', 'resources/signing.pfx', 'resources/signing.p12', 'resources/signing.jks', 'resources/signing.keystore', 'secrets.json', 'configurable/credentials.json', 'resources/token-cache.json']) {
      assert.throws(() => check(platform, { [file]: 'private' }), /must not be distributed/);
    }
  });
  test(`${name}: release manifest retains the full version and production entry point`, () => {
    assert.throws(() => check(platform, { 'package.json': null }), /was not found/);
    assert.throws(() => check(platform, { 'package.json': JSON.stringify({ ...runtimeManifest, version: runtimeManifest.version + '-stale' }) }), /complete release identifier/);
    assert.throws(() => check(platform, { 'package.json': JSON.stringify({ ...runtimeManifest, main: 'apps/server/src/run.js' }) }), /built runtime/);
    assert.throws(() => check(platform, { 'package.json': JSON.stringify({ ...runtimeManifest, devDependencies: {} }) }), /remove development dependencies/);
  });
  test(`${name}: executable architecture and embedded ASAR integrity reject corruption`, () => {
    assert.throws(() => check(platform, {}, { is32bit: true }), /Windows x64/);
    assert.throws(() => check(platform, {}, { resources: () => [] }), /one Electron ASAR integrity resource/);
    assert.throws(() => check(platform, {}, { resources: entries => [...entries, ...entries] }), /one Electron ASAR integrity resource/);
    assert.throws(() => check(platform, {}, { integrity: entries => [...entries, ...entries] }), /Only the packaged app ASAR/);
    assert.throws(() => check(platform, {}, { integrity: entries => [{ ...entries[0], file: 'resources/other.asar' }] }), /must target this ASAR/);
    assert.throws(() => check(platform, {}, { integrity: entries => [{ ...entries[0], alg: 'SHA512' }] }), /SHA256/);
    assert.throws(() => check(platform, {}, { integrity: entries => [{ ...entries[0], value: '0'.repeat(64) }] }), /EXE integrity must match/);
    assert.throws(() => check(platform, {}, { headerString: 'corrupted ASAR header' }), /EXE integrity must match/);
  });
}
