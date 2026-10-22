import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extractFile, getRawHeader, listPackage } from '@electron/asar';
import { NtExecutable, NtExecutableResource } from 'resedit';

const archive = path.resolve(process.argv[2] || 'out/StreamDashboard-win32-x64/resources/app.asar');
const executable = path.join(path.dirname(path.dirname(archive)), 'StreamDashboard.exe');
// ASAR uses host-native separators for lookup/listing, even for a Windows
// target packaged on another OS. Keep policy matching platform-independent.
const files = listPackage(archive).map(file => file.replaceAll('\\', '/'));
const readArchive = file => extractFile(archive, path.normalize(file));
const packagedManifest = JSON.parse(readArchive('package.json').toString());
const sourceManifest = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(packagedManifest.version, sourceManifest.version, 'Packaged runtime version must retain the complete release identifier');
assert.equal(packagedManifest.main, 'dist/apps/desktop/src/main.js', 'Packaged desktop entry point must use the built runtime');
assert.equal(packagedManifest.devDependencies, undefined, 'Production packaging must remove development dependencies from the runtime manifest');

const publicConfig = JSON.parse(readArchive('resources/distribution.json').toString());
assert.deepEqual(Object.keys(publicConfig).sort(), ['googleClientId', 'twitchClientId']);
assert.match(publicConfig.googleClientId, /^[\w.-]+\.apps\.googleusercontent\.com$/);
assert.ok(publicConfig.twitchClientId);
for (const file of files) {
  assert.ok(!/^\/(tests|test-results|docs|scripts|data|config|logs|\.dependencies|\.cb52-tmp|\.git)(\/|$)/.test(file), 'Unexpected packaged source or user data: ' + file);
  assert.ok(!/\.log$/.test(file), 'Unexpected packaged log: ' + file);
  assert.ok(!/(?:^|\/)\.env(?:$|\.)/i.test(file), 'Environment file must not be distributed: ' + file);
  assert.ok(!/\.(?:pfx|p12|jks|keystore)$/i.test(file), 'Signing material must not be distributed: ' + file);
  assert.ok(!/(?:^|\/)(?:secrets|credentials|token-cache)\.json$/i.test(file), 'User credentials must not be distributed: ' + file);
}
const lifecycle = readArchive('dist/apps/desktop/src/lifecycle.js').toString();
assert.match(lifecycle, /port: controller \? 48135 : 48133/);
const publicAssets = JSON.parse(readFileSync('.build/public/manifest.json','utf8'));
for (const file of publicAssets.files) {
  const bytes=readArchive('apps/'+file.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,'Packaged public asset changed: '+file.path);
}
const built = JSON.parse(readFileSync('.build/build-proof.json','utf8'));
for(const file of built.outputs.filter(file=>file.path.startsWith('dist/')&&!/^dist\/(tests|scripts)\//.test(file.path))){
  assert.equal(createHash('sha256').update(readArchive(file.path)).digest('hex'),file.sha256,'Packaged runtime changed: '+file.path);
}
if(publicAssets.profile==='production') {
  for(const file of files.filter(file=>/^\/apps\/(mobile|web)\//.test(file))) {
    assert.ok(publicAssets.files.some(entry=>'/apps/'+entry.path===file)||!path.extname(file),'Unlisted public asset: '+file);
    assert.ok(!file.endsWith('.d.ts'),'Declarations must not ship');
  }
}

// Electron Packager embeds the SHA-256 of the ASAR header in the Windows PE
// resources. Check the matching EXE and ASAR together, without rewriting either.
const pe = NtExecutable.from(readFileSync(executable), { ignoreCert: true });
assert.equal(pe.is32bit(), false, 'The portable executable must be Windows x64');
const integrityResources = NtExecutableResource.from(pe).entries.filter(entry => entry.type === 'INTEGRITY' && entry.id === 'ELECTRONASAR');
assert.equal(integrityResources.length, 1, 'The executable must embed one Electron ASAR integrity resource');
const integrity = JSON.parse(Buffer.from(integrityResources[0].bin).toString('utf8'));
const expectedFile = path.relative(path.dirname(executable), archive).replaceAll('\\', '/');
assert.equal(integrity.length, 1, 'Only the packaged app ASAR is expected');
assert.equal(integrity[0].file.replaceAll('\\', '/'), expectedFile, 'Embedded integrity must target this ASAR');
assert.equal(integrity[0].alg, 'SHA256');
const headerHash = createHash('sha256').update(getRawHeader(archive).headerString).digest('hex');
assert.equal(integrity[0].value, headerHash, 'EXE integrity must match its packaged ASAR header');
console.log('Desktop package checked: version ' + packagedManifest.version + ', public provider IDs, role ports, runtime assets, exclusions and matching EXE/ASAR integrity.');
