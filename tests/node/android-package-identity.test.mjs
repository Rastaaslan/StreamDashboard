import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gradle = readFileSync(path.join(project, 'android/app/build.gradle'), 'utf8');
const workflow = readFileSync(path.join(project, '.github/workflows/android.yml'), 'utf8');

test('Android release CI checks the exact Gradle identity without overwriting the legacy app', () => {
  const match = gradle.match(/\bapplicationId\s+'(com\.[a-z0-9.]+)'/);
  assert.ok(match, 'Gradle applicationId is explicit');
  const applicationId = match[1];
  assert.equal(applicationId, 'com.rastaaslan.streamdashboard.remote.next');
  assert.match(gradle, /applicationIdSuffix\s+'\.preview'/);
  assert.ok(workflow.includes(`"package: name='${applicationId}'"`),
    'CI validates the exact release applicationId');
  assert.ok(workflow.includes(`"package: name='${applicationId}.preview'"`),
    'CI validates the exact preview applicationId');
  assert.match(workflow, /certificate SHA-256 digest/);
  assert.match(workflow, /\$ACTUAL_CERT_SHA256" != "\$EXPECTED_CERT_SHA256"/);
  assert.ok(workflow.includes(`versionCode='$ANDROID_VERSION_CODE' versionName='$ANDROID_VERSION_NAME'`),
    'CI preserves version-code and version-name checks');
});
