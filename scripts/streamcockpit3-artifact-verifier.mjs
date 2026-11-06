import { createHash } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {verifyEmbeddedArtifactProvenance} from './streamcockpit3-embedded-provenance.mjs';

const HEX40 = /^[a-f0-9]{40}$/i, HEX64 = /^[a-f0-9]{64}$/i;
const fail = code => { throw new Error('SC3_ARTIFACT_' + code); };
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Manifest schema is portable: CI on Linux must recognize a local Windows
// drive path without allowing UNC/network locations or relative paths.
// Actual file verification remains native and requires Windows Authenticode.
const manifestAbsolute = value => typeof value === 'string' &&
  // On Windows path.isAbsolute() accepts UNC shares and device namespaces.
  // Release bundles must be local drive files, never network/device paths.
  !/^[\\/]{2}/.test(value) &&
  // Windows permits alternate data streams after a second colon. A release
  // manifest must designate an ordinary EXE/APK file, never an NTFS stream.
  !(/^[A-Za-z]:[\\/]/.test(value) && value.slice(2).includes(':')) &&
  (/^[A-Za-z]:[\\/]/.test(value) || (process.platform !== 'win32' && isAbsolute(value)));
const exactKeys = (obj, names) => obj && typeof obj === 'object' && !Array.isArray(obj) &&
  Object.keys(obj).sort().join(',') === [...names].sort().join(',');

/** Schema validation is pure; manifest signatures are NEVER trusted as claims. */
export function validateArtifactManifest(value) {
  if (!exactKeys(value, ['schemaVersion', 'sourceCommit', 'windows', 'android']) ||
      value.schemaVersion !== 1 || !HEX40.test(value.sourceCommit)) fail('MANIFEST_INVALID');
  for (const item of ['windows', 'android']) {
    const row = value[item];
    if (!exactKeys(row, ['file', 'sha256']) ||
        typeof row.file !== 'string' || !manifestAbsolute(row.file) ||
        !HEX64.test(row.sha256) || !/\.(exe|apk)$/i.test(row.file) ||
        (item === 'windows' && !/\.exe$/i.test(row.file)) ||
        (item === 'android' && !/\.apk$/i.test(row.file))) fail('MANIFEST_INVALID');
  }
  if (value.windows.file.toLowerCase() === value.android.file.toLowerCase())
    fail('MANIFEST_INVALID');
  return value;
}

export function checkPinnedCerts(config) {
  if (!HEX40.test(config.windowsThumbprint || '') ||
      !HEX64.test(config.androidCertSha256 || '')) fail('SIGNER_POLICY_MISSING');
  return { windowsThumbprint: config.windowsThumbprint.toUpperCase(),
    androidCertSha256: config.androidCertSha256.toLowerCase() };
}

function command(command, args) {
  const result = spawnSync(command, args, {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000,
    maxBuffer: 1024 * 1024, shell: false,
  });
  if (result.error || result.status !== 0) fail('VERIFIER_FAILED');
  return result.stdout;
}

function verifySourceCommit(commit) {
  const current = command('git', ['rev-parse', '--verify', 'HEAD']).trim();
  if (!HEX40.test(current) || current.toLowerCase() !== commit.toLowerCase())
    fail('SOURCE_COMMIT_MISMATCH');
  // Never give a clean-source attestation to a dirty tree / concurrent job.
  if (command('git', ['status', '--porcelain=v1', '--untracked-files=normal']).trim())
    fail('SOURCE_DIRTY');
}

async function hashFile(file) {
  if (!isAbsolute(file)) fail('PATH_INVALID');
  let stat;
  try {
    stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
        realpathSync.native(file).toLowerCase() !== resolve(file).toLowerCase())
      fail('PATH_UNSAFE');
  } catch { fail('PATH_UNAVAILABLE'); }
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of createReadStream(file, { flags: 'r' })) {
      bytes += chunk.length;
      hash.update(chunk);
    }
    const after = lstatSync(file);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs ||
        after.ino !== stat.ino || bytes !== stat.size) fail('FILE_CHANGED');
  } catch { fail('READ_FAILED'); }
  return hash.digest('hex');
}

function verifyWindowsSignature(file, expectedThumbprint) {
  if (process.platform !== 'win32') fail('WINDOWS_REQUIRED');
  // Pass only base64 data to PowerShell: no shell interpolation of filenames.
  const path64 = Buffer.from(file, 'utf8').toString('base64');
  const script = `$ErrorActionPreference='Stop';$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${path64}'));$s=Get-AuthenticodeSignature -LiteralPath $p;if($s.Status -ne 'Valid' -or $null -eq $s.SignerCertificate){exit 12};Write-Output $s.SignerCertificate.Thumbprint`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const actual = command('powershell.exe', ['-NoProfile', '-NonInteractive',
    '-EncodedCommand', encoded]).trim().toUpperCase();
  if (actual !== expectedThumbprint) fail('WINDOWS_SIGNER_MISMATCH');
}

export function checkApkSignerOutput(output, expectedSha256) {
  const lines = output.split(/\r?\n/);
  const matches = lines.map(line => line.match(/^Signer #\d+ certificate SHA-256 digest:\s*([a-f0-9]{64})\s*$/i))
    .filter(Boolean);
  if (matches.length !== 1 || matches[0][1].toLowerCase() !== expectedSha256)
    fail('ANDROID_SIGNER_MISMATCH');
  // A pinned certificate is not sufficient: a v1-only APK may still print
  // "Verifies". G4 requires a verified APK Signature Scheme v2 or v3.
  if (!/^Verifies[ \t]*$/mi.test(output)) fail('ANDROID_VERIFY_UNCONFIRMED');
  if (!/^Verified using (v[23]) scheme \(APK Signature Scheme \1\): true[ \t]*$/mi.test(output))
    fail('ANDROID_STRONG_SCHEME_MISSING');
  return true;
}

function verifyAndroidSignature(file, expectedSha256, apksignerJar) {
  // Android SDK's apksigner is normally a .bat script on Windows. Invoke the
  // trusted build-tools JAR with Java directly, never through cmd.exe/shell.
  if (!apksignerJar || !isAbsolute(apksignerJar) ||
      !/\.jar$/i.test(apksignerJar) || !existsSync(apksignerJar))
    fail('APKSIGNER_MISSING');
  const output = command('java', ['-jar', apksignerJar, 'verify', '--verbose', '--print-certs', file]);
  checkApkSignerOutput(output, expectedSha256);
}

export async function verifyArtifactBundle(manifest, policy) {
  validateArtifactManifest(manifest);
  const pins = checkPinnedCerts(policy);
  verifySourceCommit(manifest.sourceCommit);
  for (const key of ['windows', 'android'])
    if ((await hashFile(manifest[key].file)) !== manifest[key].sha256.toLowerCase())
      fail(key.toUpperCase() + '_HASH_MISMATCH');
  verifyWindowsSignature(manifest.windows.file, pins.windowsThumbprint);
  verifyAndroidSignature(manifest.android.file, pins.androidCertSha256, policy.apksignerJar);
  // Check again after external inspectors, never trust a changed file.
  for (const key of ['windows', 'android'])
    if ((await hashFile(manifest[key].file)) !== manifest[key].sha256.toLowerCase())
      fail('FILE_CHANGED');
  verifySourceCommit(manifest.sourceCommit);
  // Inspect both actual archives, not their self-attested manifest fields:
  // Windows PE ASAR integrity resource -> ASAR build info, APK ZIP asset.
  // This never substitutes for stable production signing or operator G4 tests.
  const provenance=verifyEmbeddedArtifactProvenance(manifest.windows.file,
    manifest.android.file,manifest.sourceCommit);
  for(const key of ['windows','android'])
    if((await hashFile(manifest[key].file))!==manifest[key].sha256.toLowerCase())
      fail('FILE_CHANGED');
  verifySourceCommit(manifest.sourceCommit);
  return {verified:true,sourceCommit:manifest.sourceCommit,
    windowsSha256:manifest.windows.sha256,androidSha256:manifest.android.sha256,
    embeddedSourceTreeSha256:provenance.sourceTreeSha256};
}

async function main() {
  const manifestFile = process.argv[2];
  if (!manifestFile || !isAbsolute(manifestFile)) fail('MANIFEST_PATH_REQUIRED');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const result = await verifyArtifactBundle(manifest, {
    windowsThumbprint: process.env.SC3_TRUSTED_WINDOWS_CERT_SHA1,
    androidCertSha256: process.env.SC3_TRUSTED_ANDROID_CERT_SHA256,
    apksignerJar: process.env.SC3_APKSIGNER_JAR,
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error));process.exitCode = 1; });
