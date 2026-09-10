import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

async function files(root: string): Promise<string[]> {
  return (await readdir(root, { withFileTypes: true }))
    .flatMap(entry => entry.name === '_integration_sources' || entry.name === 'node_modules' || entry.name === 'dist' ? [] : entry.isDirectory() ? [] : [path.join(root, entry.name)])
    .concat(...await Promise.all((await readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && !['_integration_sources', 'node_modules', 'dist', '.git'].includes(entry.name))
      .map(entry => files(path.join(root, entry.name)))));
}
const sourceFiles = (await files('.')).filter(file => /\.(?:[cm]?[jt]s|json|html)$/.test(file) && !file.includes('package-lock'));
const failures: string[] = [];
for (const file of sourceFiles) {
  const content = await readFile(file, 'utf8');
  for (const pattern of [/nodeIntegration\s*:\s*true/, /contextIsolation\s*:\s*false/, /sandbox\s*:\s*false/, /webSecurity\s*:\s*false/, /client_secret\s*[:=]/i]) {
    if (pattern.test(content)) failures.push(`${file}: ${pattern}`);
  }
}
const publicSurfaces = ['apps/web/app.js', 'apps/mobile/mobile.js', 'packages/contracts/src/index.ts'];
for (const file of publicSurfaces) {
  const content = await readFile(file, 'utf8');
  if (file.endsWith('.js')) {
    // Desktop may legitimately submit an OBS password entered by the local user to the
    // local API. The important invariant is that OAuth/provider credentials never appear
    // in renderer code, and that the mobile client never sees an OBS password either.
    const forbidden = file === 'apps/web/app.js'
      ? ['accessToken', 'refreshToken', 'deviceCode']
      : ['accessToken', 'refreshToken', 'deviceCode', 'obsPassword'];
    for (const secret of forbidden) if (content.includes(secret)) failures.push(`${file}: secret provider exposé (${secret})`);
  }
}
const mobile = await readFile('apps/mobile/mobile.js', 'utf8');
if (/\.innerHTML\s*=/.test(mobile)) failures.push('apps/mobile/mobile.js: données distantes injectées via innerHTML');
if (/ws\/v1\?device=|[?&]device=\$\{/.test(mobile)) failures.push('apps/mobile/mobile.js: credential device longue placée dans URL WebSocket');
if (!mobile.includes('/api/v1/remote/ws-ticket')) failures.push('apps/mobile/mobile.js: ticket WebSocket court absent');
const server = await readFile('apps/server/src/index.ts', 'utf8');
if (server.includes("req.method === 'GET' || req.path === '/v1/remote/pair'")) failures.push('apps/server/src/index.ts: GET distants globalement exemptés d’authentification');
if (!server.includes("['/v1/health', '/v1/capabilities']")) failures.push('apps/server/src/index.ts: allowlist GET public remote attendue absente');
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Security check OK (${sourceFiles.length} fichiers, Electron + surfaces publiques + garde-fous remote/mobile)`);
