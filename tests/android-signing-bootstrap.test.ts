import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const script = readFileSync(new URL('../scripts/android-signing-bootstrap.ps1', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/android.yml', import.meta.url), 'utf8');
const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');

describe('signature Android permanente', () => {
  it('génère un keystore local sans le versionner ni écraser une identité existante', () => {
    expect(script).toContain('keytool');
    expect(script).toContain('streamdashboard-remote.jks');
    expect(script).toContain('if (Test-Path $KeystorePath)');
    expect(script).toContain('Ne le remplace pas');
    expect(gitignore).toContain('*.jks');
    expect(gitignore).toContain('*.keystore');
  });

  it('configure exactement les secrets attendus par la CI', () => {
    for (const secret of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD', 'ANDROID_CERT_SHA256']) {
      expect(script).toContain(`secret set ${secret}`);
      expect(workflow).toContain(`secrets.${secret}`);
    }
    expect(workflow).toContain('Require stable Android signing identity');
    expect(workflow).toContain('assembleRelease');
    expect(script).toContain('certificateSha256');
  });

  it('refuse de publier sans signature stable et ne publie que la RC', () => {
    expect(workflow).toContain('Refusing to publish an ephemeral debug-signed APK');
    expect(workflow).toContain('exit 1');
    expect(workflow).toContain('verify --verbose --print-certs');
    expect(workflow).toContain('ACTUAL_CERT_SHA256');
    expect(workflow).toContain('path: StreamDashboard-Remote-rc.apk');
    expect(workflow).not.toContain('StreamDashboard-Remote-debug.apk');
    expect(workflow).not.toContain('StreamDashboard-Remote-unsigned.apk');
    expect(workflow).not.toContain('assembleDebug assembleRelease');
  });

  it('ne versionne aucun secret ou keystore Android', () => {
    const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split(/\r?\n/);
    expect(tracked.filter(file => /(?:\.jks|\.keystore|SIGNING-BACKUP\.txt)$/i.test(file))).toEqual([]);
    expect(gitignore).toContain('**/SIGNING-BACKUP.txt');
  });
});
