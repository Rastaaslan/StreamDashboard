import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error Standalone Node mjs verifier intentionally has no declaration file.
import { validateArtifactManifest, checkPinnedCerts, checkApkSignerOutput } from '../scripts/streamcockpit3-artifact-verifier.mjs';

const valid = {
  schemaVersion: 1,
  sourceCommit: 'a'.repeat(40),
  windows: { file: 'C:\\SC3\\StreamCockpit.exe', sha256: 'b'.repeat(64) },
  android: { file: 'C:\\SC3\\StreamCockpit.apk', sha256: 'c'.repeat(64) },
};
const pins = { windowsThumbprint: 'a'.repeat(40), androidCertSha256: 'b'.repeat(64) };

describe('StreamCockpit 3.0 offline release artifact verification', () => {
  it('accepts only exact separated Windows EXE and Android APK manifest records', () => {
    expect(validateArtifactManifest(valid)).toEqual(valid);
    for (const changed of [
      { ...valid, schemaVersion: 2 },
      { ...valid, sourceCommit: 'not-a-commit' },
      { ...valid, extra: true },
      { ...valid, windows: { ...valid.windows, sha256: 'nope' } },
      { ...valid, android: { ...valid.android, file: 'https://bad.example/c.apk' } },
      { ...valid, android: { ...valid.android, file: valid.windows.file } },
      { ...valid, windows: { ...valid.windows, file: 'relative.exe' } },
      // Windows UNC shares and device paths must never become release inputs.
      { ...valid, windows: { ...valid.windows, file: String.raw`\\fileserver\share\StreamCockpit.exe` } },
      { ...valid, windows: { ...valid.windows, file: String.raw`\\?\C:\SC3\StreamCockpit.exe` } },
      { ...valid, windows: { ...valid.windows, file: String.raw`\Windows\Temp\StreamCockpit.exe` } },
      { ...valid, android: { ...valid.android, file: 'C:\\SC3\\file.zip' } },
    ]) expect(() => validateArtifactManifest(changed)).toThrow('SC3_ARTIFACT_MANIFEST_INVALID');
  });

  it('requires trusted independent signer pins (never a self-attested manifest signer)', () => {
    expect(checkPinnedCerts(pins)).toEqual({
      windowsThumbprint: 'A'.repeat(40), androidCertSha256: 'b'.repeat(64),
    });
    expect(() => checkPinnedCerts({ windowsThumbprint: '', androidCertSha256: 'b'.repeat(64) }))
      .toThrow('SC3_ARTIFACT_SIGNER_POLICY_MISSING');
    expect(() => checkPinnedCerts({ windowsThumbprint: 'a'.repeat(40), androidCertSha256: '' }))
      .toThrow('SC3_ARTIFACT_SIGNER_POLICY_MISSING');
  });

  it('refuses zero, multiple or wrong APK signer digests even when text mentions success', () => {
    const one = 'Verifies\nVerified using v1 scheme (JAR signing): true\n' +
      'Verified using v2 scheme (APK Signature Scheme v2): true\n' +
      'Signer #1 certificate SHA-256 digest: ' + 'b'.repeat(64) + '\n';
    expect(checkApkSignerOutput(one, 'b'.repeat(64))).toBe(true);
    for (const message of [
      'Verifies\n',
      one + 'Signer #2 certificate SHA-256 digest: ' + 'b'.repeat(64) + '\n',
      one.replace('b'.repeat(64), 'a'.repeat(64)),
    ]) expect(() => checkApkSignerOutput(message, 'b'.repeat(64)))
      .toThrow('SC3_ARTIFACT_ANDROID_SIGNER_MISMATCH');
  });

  it('refuses an APK signed only with v1 even if apksigner says Verifies and its certificate is pinned', () => {
    const digest = 'Signer #1 certificate SHA-256 digest: ' + 'b'.repeat(64) + '\n';
    const v1Only = 'Verifies\nVerified using v1 scheme (JAR signing): true\n' +
      'Verified using v2 scheme (APK Signature Scheme v2): false\n' +
      'Verified using v3 scheme (APK Signature Scheme v3): false\n' + digest;
    expect(() => checkApkSignerOutput(v1Only, 'b'.repeat(64)))
      .toThrow('SC3_ARTIFACT_ANDROID_STRONG_SCHEME_MISSING');
  });

  it('accepts v3 signing but rejects an unconfirmed or mismatched strong-scheme claim', () => {
    const cert = 'Signer #1 certificate SHA-256 digest: ' + 'b'.repeat(64) + '\n';
    const v3 = 'Verifies\nVerified using v2 scheme (APK Signature Scheme v2): false\n' +
      'Verified using v3 scheme (APK Signature Scheme v3): true\n' + cert;
    expect(checkApkSignerOutput(v3, 'b'.repeat(64))).toBe(true);
    expect(() => checkApkSignerOutput(v3.replace('Verifies\n', ''), 'b'.repeat(64)))
      .toThrow('SC3_ARTIFACT_ANDROID_VERIFY_UNCONFIRMED');
    expect(() => checkApkSignerOutput(v3.replace('APK Signature Scheme v3', 'APK Signature Scheme v2'), 'b'.repeat(64)))
      .toThrow('SC3_ARTIFACT_ANDROID_STRONG_SCHEME_MISSING');
  });

  it('rejects a missing manifest before any packaging or provider call', () => {
    const root = resolve(import.meta.dirname, '..');
    const script = resolve(root, 'scripts/streamcockpit3-artifact-verifier.mjs');
    const outcome = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain('SC3_ARTIFACT_MANIFEST_PATH_REQUIRED');
  });

  it('does not replace source qualification with the historic Next2.1 matrix', () => {
    const root = resolve(import.meta.dirname, '..');
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['streamcockpit3:release-check']).toContain('streamcockpit3-readiness.mjs --final');
    expect(pkg.scripts['streamcockpit3:artifacts']).toContain('streamcockpit3-artifact-verifier.mjs');
  });
});
