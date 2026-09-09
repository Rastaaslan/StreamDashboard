import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

async function files(root: string): Promise<string[]> { return (await readdir(root, { withFileTypes: true })).flatMap(entry => entry.name === '_integration_sources' || entry.name === 'node_modules' || entry.name === 'dist' ? [] : entry.isDirectory() ? [] : [path.join(root, entry.name)]).concat(...await Promise.all((await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory() && !['_integration_sources', 'node_modules', 'dist', '.git'].includes(entry.name)).map(entry => files(path.join(root, entry.name))))); }
const sourceFiles = (await files('.')).filter(file => /\.(?:ts|js|json|html)$/.test(file) && !file.includes('package-lock'));
const failures: string[] = [];
for (const file of sourceFiles) {
  const content = await readFile(file, 'utf8');
  for (const pattern of [/nodeIntegration\s*:\s*true/, /contextIsolation\s*:\s*false/, /sandbox\s*:\s*false/, /webSecurity\s*:\s*false/, /client_secret\s*[:=]/i]) if (pattern.test(content)) failures.push(`${file}: ${pattern}`);
}
const publicSurfaces = ['apps/web/app.js', 'packages/contracts/src/index.ts'];
for (const file of publicSurfaces) {
  const content = await readFile(file, 'utf8');
  for (const secret of ['accessToken', 'refreshToken', 'deviceCode', 'obsPassword']) if (content.includes(secret) && file === 'apps/web/app.js' && secret !== 'obsPassword') failures.push(`${file}: secret OAuth exposé (${secret})`);
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; } else console.log(`Security check OK (${sourceFiles.length} fichiers, règles Electron et surfaces publiques)`);
