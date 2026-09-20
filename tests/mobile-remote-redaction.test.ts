import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../apps/server/src/index.ts', import.meta.url), 'utf8');
const remotePolicy = readFileSync(new URL('../apps/server/src/remote-policy.ts', import.meta.url), 'utf8');

describe('redaction des réponses Mobile', () => {
  it('projette les mutations distantes via le snapshot Remote', () => {
    expect(server).toContain("const responseState = (req: express.Request, value: DashboardState) => isRemoteRequest(req) ? toRemoteDashboardState(value) : value");
    expect((server.match(/responseState\(req, await changed\(\)\)/g) || []).length).toBeGreaterThanOrEqual(7);
    for (const handler of [
      "const planningUpdate:",
      "const planningRetry:",
      "const planningDelete:",
      "const recurrenceException:",
      "app.post(['/api/twitch/disconnect', '/api/v1/twitch/disconnect']",
      "app.post('/api/v1/google/disconnect'",
    ]) expect(server).toContain(handler);
  });

  it('expose uniquement le résultat utile des providers Planning', () => {
    const start = remotePolicy.indexOf('const projectItem');
    const end = remotePolicy.indexOf('\n\n  return {', start);
    const projector = remotePolicy.slice(start, end);
    for (const field of ['status: link.status','lastError: link.lastError','lastSyncedAt: link.lastSyncedAt','deletedRemotely: link.deletedRemotely']) expect(projector).toContain(field);
    for (const field of ['remoteId','remoteRevision','calendarId']) expect(projector).not.toContain(field);
    expect(projector).toContain('conflict: { provider: item.conflict.provider, detectedAt: item.conflict.detectedAt }');
  });

  it('ne projette pas les détails Runtime Desktop dans l’état Remote', () => {
    expect(remotePolicy).not.toContain('logsPath:');
    expect(remotePolicy).not.toContain('nodeVersion:');
    expect(remotePolicy).not.toContain('electronVersion:');
  });
});
