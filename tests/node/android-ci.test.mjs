import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const workflow = readFileSync(join(repository, '.github/workflows/android.yml'), 'utf8');
const gradle = readFileSync(join(repository, 'android/app/build.gradle'), 'utf8');
const version = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')).version;
const versionCode = gradle.match(/def buildVersionCode[^\n]*\?: '(\d+)'/)?.[1];
const product = 'com.rastaaslan.streamdashboard.remote.next';
const dispatchOnly = "github.event_name == 'workflow_dispatch'";
// Execute the actual workflow run blocks, not a reimplementation of its gates.
// YAML parsing is also part of the static workflow review. These fixtures do not
// invoke Gradle, real Android tools, provider endpoints or a real signing key.
const steps = workflow.split(/^      - name: /m).slice(1).map(block => ({ name: block.split('\n')[0], block }));
function step(name) {
  const matches = steps.filter(value => value.name === name);
  assert.equal(matches.length, 1, `Expected exactly one workflow step: ${name}`);
  return matches[0];
}
function runBlock(name) {
  const lines = step(name).block.split('\n');
  const first = lines.indexOf('        run: |');
  assert.notEqual(first, -1, `Missing script in ${name}`);
  return lines.slice(first + 1).map(line => {
    if (!line.trim()) return '';
    assert.ok(line.startsWith('          '), `Unexpected script indentation in ${name}`);
    return line.slice(10);
  }).join('\n');
}
const condition = name => step(name).block.match(/^        if: (.+)$/m)?.[1];
const shellOnly = { skip: process.platform === 'win32' ? 'Android CI shell fixtures target the Linux runner.' : false };

function withFixture(operation) {
  const directory = mkdtempSync(join(tmpdir(), 'sd-android-ci-'));
  const target = relative => join(directory, relative);
  const put = (relative, content, mode) => {
    const file = target(relative); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content, { mode }); return file;
  };
  try {
    put('android/app/build.gradle', gradle);
    put('package.json', JSON.stringify({ version }));
    put('resources/distribution.json', JSON.stringify({ twitchClientId: 'syntheticPublicClient123' }));
    put('github-env', '');
    const signer = put('sdk/build-tools/35.0.0/apksigner', `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == verify && "$2" == --verbose ]]
if [[ "$FIXTURE_SIGNATURE_STATUS" != 0 ]]; then exit "$FIXTURE_SIGNATURE_STATUS"; fi
if [[ "$3" == --print-certs ]]; then
  for ((i=1; i<=FIXTURE_SIGNER_COUNT; i++)); do
    printf 'Signer #%s certificate SHA-256 digest: %s\\n' "$i" "$FIXTURE_CERT_SHA256"
  done
fi
`, 0o700);
    const aapt = put('sdk/build-tools/35.0.0/aapt', `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == dump && "$2" == badging ]]
PACKAGE_ID="$FIXTURE_PACKAGE_ID"
VERSION_NAME="$FIXTURE_VERSION_NAME"
if [[ "$3" == *QA-preview.apk ]]; then PACKAGE_ID+='.preview'; VERSION_NAME+='-preview'; fi
printf "package: name='%s' versionCode='%s' versionName='%s' platformBuildVersionName='15'\\n" "$PACKAGE_ID" "$FIXTURE_VERSION_CODE" "$VERSION_NAME"
if [[ "$3" == *QA-preview.apk ]]; then printf "application-label:'StreamDashboard Preview'\\n"; fi
`, 0o700);
    for (const filename of ['StreamDashboard-Next-QA-debug.apk', 'StreamDashboard-Next-QA-preview.apk', `StreamDashboard-Next-${version}-android.apk`]) put(filename, 'synthetic APK fixture');
    const env = {
      PATH: process.env.PATH, GITHUB_ENV: target('github-env'), RUNNER_TEMP: directory,
      ANDROID_HOME: target('sdk'), ANDROID_APKSIGNER: signer, ANDROID_AAPT: aapt,
      ANDROID_APPLICATION_ID: product, ANDROID_VERSION_CODE: versionCode, ANDROID_VERSION_NAME: version,
      ANDROID_CERT_SHA256: 'A'.repeat(64),
      KEYSTORE_BASE64: Buffer.from('synthetic keystore fixture').toString('base64'),
      ANDROID_KEYSTORE_PASSWORD: 'synthetic-store-password', ANDROID_KEY_ALIAS: 'synthetic-alias', ANDROID_KEY_PASSWORD: 'synthetic-key-password',
      FIXTURE_SIGNATURE_STATUS: '0', FIXTURE_SIGNER_COUNT: '1', FIXTURE_CERT_SHA256: 'aa:'.repeat(31) + 'aa',
      FIXTURE_PACKAGE_ID: product, FIXTURE_VERSION_CODE: versionCode, FIXTURE_VERSION_NAME: version,
    };
    const run = (name, override = {}) => spawnSync('bash', ['-euo', 'pipefail', '-c', runBlock(name)], {
      cwd: directory, env: { ...env, ...override }, encoding: 'utf8', timeout: 10_000,
    });
    return operation({ directory, target, put, env, run });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
function accepted(result) { assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error)); }
function refused(result, message) {
  assert.notEqual(result.status, 0, 'Expected workflow gate to refuse this fixture');
  if (message) assert.match(result.stderr, message);
}

test('PR qualification needs no secrets and the release upload follows all dispatch-only gates', () => {
  for (const value of steps.filter(value => value.block.includes('secrets.'))) assert.equal(condition(value.name), dispatchOnly, value.name);
  const releaseNames = ['Require release Twitch client ID', 'Require stable Android signing identity', 'Build stable signed release APK', 'Verify release APK identity, version and stable signature', 'Upload stable Android release APK'];
  let previous = -1;
  for (const name of releaseNames) {
    assert.equal(condition(name), dispatchOnly, name);
    const index = steps.findIndex(value => value.name === name);
    assert.ok(index > previous); previous = index;
    assert.doesNotMatch(step(name).block, /continue-on-error/);
  }
  assert.equal(condition('Upload Android QA artifacts'), undefined);
  assert.match(step('Upload Android QA artifacts').block, /name: StreamDashboard-Next-QA-/);
  assert.match(step('Upload Android QA artifacts').block, /Android-QA-README\.txt/);
  const qaBuild = runBlock('Lint, test and build QA APKs without signing secrets');
  assert.match(qaBuild, /testDebugUnitTest lintDebug assembleDebug assemblePreview/);
  assert.doesNotMatch(qaBuild, /assembleRelease|secrets\./);
  assert.match(qaBuild, /not a stable signed release or an update for an installed app/);
  assert.doesNotMatch(workflow, /GOOGLE_ANDROID_CLIENT_ID|900000|0\.9\.0-rc/);
});

test('metadata uses the product package and checked-in version, refusing stale package or manifest identity', shellOnly, () => {
  withFixture(({ run, target, put }) => {
    accepted(run('Read Android product identity', { ANDROID_VERSION_NAME: '0.9.0-rc.1', ANDROID_VERSION_CODE: '900001' }));
    const exported = readFileSync(target('github-env'), 'utf8');
    assert.match(exported, new RegExp(`^ANDROID_VERSION_CODE=${versionCode}$`, 'm'));
    assert.ok(exported.includes(`ANDROID_VERSION_NAME=${version}\n`));
    assert.ok(exported.includes(`ANDROID_APPLICATION_ID=${product}\n`));
    put('package.json', JSON.stringify({ version: '0.9.0-rc.1' }));
    refused(run('Read Android product identity'), /versions differ/);
    put('package.json', JSON.stringify({ version }));
    put('android/app/build.gradle', gradle.replace(`applicationId '${product}'`, "applicationId 'com.rastaaslan.streamdashboard.remote'"));
    refused(run('Read Android product identity'), /Unexpected Android product identity/);
  });
});

test('release keeps Twitch mandatory but accepts the public distribution ID without a Google ID or secrets', shellOnly, () => {
  withFixture(({ run, put, target }) => {
    accepted(run('Require release Twitch client ID'));
    assert.match(readFileSync(target('github-env'), 'utf8'), /TWITCH_ANDROID_CLIENT_ID=syntheticPublicClient123/);
    put('resources/distribution.json', '{}');
    refused(run('Require release Twitch client ID'), /valid Twitch client ID is required/);
    refused(run('Require release Twitch client ID', { TWITCH_ANDROID_CLIENT_ID: 'invalid client id' }), /valid Twitch client ID is required/);
    accepted(run('Require release Twitch client ID', { TWITCH_ANDROID_CLIENT_ID: 'suppliedPublicClient123' }));
  });
});

test('stable signing refuses every missing secret and malformed fingerprint before writing the keystore', shellOnly, () => {
  withFixture(({ run, target }) => {
    for (const key of ['KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD', 'ANDROID_CERT_SHA256']) {
      refused(run('Require stable Android signing identity', { [key]: '' }), /Refusing to publish an ephemeral debug-signed APK/);
      assert.equal(existsSync(target('streamdashboard-remote.jks')), false);
    }
    refused(run('Require stable Android signing identity', { ANDROID_CERT_SHA256: 'not-a-fingerprint' }), /64 hexadecimal/);
    assert.equal(existsSync(target('streamdashboard-remote.jks')), false);
    accepted(run('Require stable Android signing identity'));
    assert.equal(readFileSync(target('streamdashboard-remote.jks'), 'utf8'), 'synthetic keystore fixture');
    assert.equal(statSync(target('streamdashboard-remote.jks')).mode & 0o777, 0o600);
  });
});

test('QA verifies both product and preview identities without claiming a stable signer', shellOnly, () => {
  withFixture(({ run }) => {
    accepted(run('Verify QA APK identities and signatures', { FIXTURE_CERT_SHA256: '', ANDROID_CERT_SHA256: '' }));
    refused(run('Verify QA APK identities and signatures', { FIXTURE_PACKAGE_ID: 'com.rastaaslan.streamdashboard.remote' }), /QA APK package or version mismatch/);
    refused(run('Verify QA APK identities and signatures', { FIXTURE_VERSION_CODE: '900001' }), /QA APK package or version mismatch/);
    refused(run('Verify QA APK identities and signatures', { FIXTURE_SIGNATURE_STATUS: '1' }));
  });
});

test('release accepts only the expected signer, normalizing the public SHA-256 notation', shellOnly, () => {
  withFixture(({ run }) => {
    accepted(run('Verify release APK identity, version and stable signature'));
    refused(run('Verify release APK identity, version and stable signature', { FIXTURE_CERT_SHA256: 'B'.repeat(64) }), /SHA-256 mismatch/);
    refused(run('Verify release APK identity, version and stable signature', { FIXTURE_SIGNER_COUNT: '0' }), /Exactly one stable/);
    refused(run('Verify release APK identity, version and stable signature', { FIXTURE_SIGNER_COUNT: '2' }), /Exactly one stable/);
    refused(run('Verify release APK identity, version and stable signature', { FIXTURE_SIGNATURE_STATUS: '1' }));
  });
});

test('a valid signature cannot conceal an old Android package, version name or version code', shellOnly, () => {
  withFixture(({ run }) => {
    for (const override of [
      { FIXTURE_PACKAGE_ID: 'com.rastaaslan.streamdashboard.remote' },
      { FIXTURE_VERSION_CODE: '900001' },
      { FIXTURE_VERSION_NAME: '0.9.0-rc.1' },
    ]) refused(run('Verify release APK identity, version and stable signature', override), /Release APK package or version mismatch/);
  });
});
