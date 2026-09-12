import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

async function files(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const direct = entries.flatMap(entry =>
    entry.name === '_integration_sources' || entry.name === 'node_modules' || entry.name === 'dist'
      ? []
      : entry.isDirectory() ? [] : [path.join(root, entry.name)]);
  const nested = await Promise.all(entries
    .filter(entry => entry.isDirectory() && !['_integration_sources', 'node_modules', 'dist', '.git'].includes(entry.name))
    .map(entry => files(path.join(root, entry.name))));
  return direct.concat(...nested);
}

const sourceFiles = (await files('.')).filter(file => /\.(?:[cm]?[jt]s|json|html)$/.test(file) && !file.includes('package-lock'));
const failures: string[] = [];
for (const file of sourceFiles) {
  const content = await readFile(file, 'utf8');
  for (const pattern of [
    /nodeIntegration\s*:\s*true/,
    /contextIsolation\s*:\s*false/,
    /sandbox\s*:\s*false/,
    /webSecurity\s*:\s*false/,
    /allowRunningInsecureContent\s*:\s*true/,
    /client_secret\s*:\s*['"][^'"]+['"]/i,
  ]) {
    if (pattern.test(content)) failures.push(`${file}: ${pattern}`);
  }
}

const publicSurfaces = ['apps/web/app.js', 'apps/mobile/mobile.js', 'apps/mobile/transport.js', 'apps/mobile/storage.js', 'packages/contracts/src/index.ts'];
for (const file of publicSurfaces) {
  const content = await readFile(file, 'utf8');
  if (!file.endsWith('.js')) continue;
  // Desktop may legitimately submit an OBS password entered by the local user to the
  // loopback API. OAuth/provider credentials must never be embedded in renderer code;
  // mobile must additionally never know the OBS password.
  const forbidden = file === 'apps/web/app.js'
    ? ['accessToken', 'refreshToken', 'deviceCode', 'clientSecret']
    : ['accessToken', 'refreshToken', 'deviceCode', 'obsPassword', 'clientSecret'];
  for (const secret of forbidden) if (content.includes(secret)) failures.push(`${file}: secret provider exposé (${secret})`);
}

const mobile = `${await readFile('apps/mobile/mobile.js', 'utf8')}\n${await readFile('apps/mobile/transport.js', 'utf8')}`;
if (/\.innerHTML\s*=/.test(mobile)) failures.push('apps/mobile/mobile.js: données distantes injectées via innerHTML');
if (/ws\/v1\?device=|[?&]device=\$\{/.test(mobile)) failures.push('apps/mobile/mobile.js: credential device longue placée dans URL WebSocket');
if (!mobile.includes('/api/v1/remote/ws-ticket')) failures.push('apps/mobile: ticket WebSocket court absent');
if (mobile.includes('Access-Control-Allow-Origin: *')) failures.push('apps/mobile: origine CORS globale interdite');

const server = await readFile('apps/server/src/index.ts', 'utf8');
if (server.includes("req.method === 'GET' || req.path === '/v1/remote/pair'")) failures.push('apps/server/src/index.ts: GET distants globalement exemptés d’authentification');
if (!server.includes("['/v1/health', '/v1/capabilities']")) failures.push('apps/server/src/index.ts: allowlist GET public remote attendue absente');
if (!server.includes('parseRemoteCommand(body, snapshot())')) failures.push('apps/server/src/index.ts: politique de commandes remote dédiée absente');
if (!server.includes('toRemoteDashboardState')) failures.push('apps/server/src/index.ts: projection de state remote nettoyée absente');
if (!server.includes("req.path.startsWith('/mobile')")) failures.push('apps/server/src/index.ts: garde statique LAN/mobile absente');

const remotePolicy = await readFile('apps/server/src/remote-policy.ts', 'utf8');
for (const forbiddenCommand of ["case 'obs.record'", "case 'obs.scene'", "case 'obs.browser.refresh'", "case 'checklist.reset'"]) {
  if (remotePolicy.includes(forbiddenCommand)) failures.push(`apps/server/src/remote-policy.ts: commande sensible explicitement autorisée (${forbiddenCommand})`);
}
if (!remotePolicy.includes("case 'session.start'")) failures.push('apps/server/src/remote-policy.ts: workflow Start distant absent');
if (!remotePolicy.includes('command.force === true')) failures.push('apps/server/src/remote-policy.ts: garde force:true absente');

const logger = await readFile('apps/desktop/src/logger.ts', 'utf8');
for (const secretName of ['credential', 'ticket', 'verifier', 'client[_-]?secret']) {
  if (!logger.includes(secretName)) failures.push(`apps/desktop/src/logger.ts: redaction ${secretName} absente`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Security check OK (${sourceFiles.length} fichiers, Electron + secrets + surfaces publiques + garde-fous remote/mobile)`);
}
