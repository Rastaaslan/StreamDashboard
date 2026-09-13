import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = readFileSync(new URL('../scripts/android-signing-bootstrap.ps1', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/android.yml', import.meta.url), 'utf8');
const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');

describe('signature Android permanente', () => {
  it('génère un keystore local sans le versionner', () => {
    expect(script).toContain('keytool');
    expect(script).toContain('streamdashboard-remote.jks');
    expect(script).toContain("throw \"Le keystore existe déjà");
    expect(gitignore).toContain('*.jks');
    expect(gitignore).toContain('*.keystore');
  });

  it('configure exactement les secrets attendus par la CI', () => {
    for (const secret of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) {
      expect(script).toContain(`secret set ${secret}`);
      expect(workflow).toContain(`secrets.${secret}`);
    }
    expect(workflow).toContain('Prepare stable signing identity when configured');
    expect(workflow).toContain('assembleRelease');
  });
});
