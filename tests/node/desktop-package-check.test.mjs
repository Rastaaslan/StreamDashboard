import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const filesystemPath = require.resolve('@electron/asar/lib/filesystem.js');
const asarRequire = createRequire(filesystemPath);
const checker = readFileSync(new URL('../../scripts/check-desktop-package.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');
const fixture = {
  'resources/distribution.json': JSON.stringify({ googleClientId: 'public.apps.googleusercontent.com', twitchClientId: 'public' }),
  'dist/apps/desktop/src/lifecycle.js': 'startDashboardServer({ port: 48132 });',
  'apps/mobile/shared/planning-editor.js': 'planning helper',
  'apps/web/preview/preview.js': 'renderer',
  'dist/integrations/obs/src/client.js': 'OBS client',
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
  return fs;
}
function check(platform, changes = {}, script = checker) {
  const entries = { ...fixture, ...changes };
  for (const file of Object.keys(entries)) if (entries[file] === null) delete entries[file];
  const fs = filesystem(platform, entries);
  vm.runInNewContext(script, {
    assert, path: platform, process: { argv: ['node', 'checker', 'app.asar'] }, console: { log() {} },
    listPackage: () => fs.listFiles(),
    extractFile: (_archive, file) => {
      fs.getFile(file); // Real ASAR lookup: unnormalized nested paths fail on Windows.
      return Buffer.from(entries[file.replaceAll('\\', '/')]);
    },
    readFileSync: file => Buffer.from(fixture[file.replaceAll('\\', '/')]),
  }, { filename: 'check-desktop-package.mjs' });
}

test('reproduces the old ASAR Windows lookup failure with the existing nested lifecycle layout', () => {
  assert.throws(() => check(path.win32, {}, checker.replace('path.normalize(file)', 'file')), /lifecycle\.js.*was not found/);
});
for (const platform of [path.posix, path.win32]) {
  const name = platform === path.win32 ? 'Windows' : 'POSIX';
  test(`${name}: package checker reads nested runtime assets`, () => check(platform));
  test(`${name}: package checker retains security, port and source/asset invariants`, () => {
    assert.throws(() => check(platform, { 'dist/apps/desktop/src/lifecycle.js': null }), /was not found/);
    assert.throws(() => check(platform, { 'dist/apps/desktop/src/lifecycle.js': 'port: 47832' }), /48132/);
    assert.throws(() => check(platform, { 'resources/distribution.json': JSON.stringify({ googleClientId: 'public.apps.googleusercontent.com', twitchClientId: 'public', googleClientSecret: 'private' }) }), /googleClientSecret/);
    for (const file of ['apps/mobile/shared/planning-editor.js', 'apps/web/preview/preview.js', 'dist/integrations/obs/src/client.js']) {
      assert.throws(() => check(platform, { [file]: 'stale build' }), /Packaged asset diverges/);
    }
    for (const directory of ['tests','test-results','docs','scripts','.dependencies','.cb52-tmp','.git']) {
      assert.throws(() => check(platform, { [`${directory}/unexpected.txt`]: 'excluded' }), /Unexpected packaged source/);
    }
    assert.throws(() => check(platform, { 'runtime.log': 'private' }), /Unexpected packaged log/);
  });
}
