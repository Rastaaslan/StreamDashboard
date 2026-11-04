import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { expect, it, vi } from 'vitest';
import { MomentsPipeline } from '../apps/server/src/streamcockpit-moments.js';
import { MomentsSqliteStorage } from '../apps/server/src/streamcockpit-moments-sqlite.js';
import { createTwitchMomentRouter, twitchMomentActor } from '../apps/server/src/streamcockpit-twitch-moment-router.js';
import { RemoteAuth } from '../apps/server/src/remote-auth.js';
import { SimpleMomentsTwitch } from '../integrations/twitch/src/streamcockpit-simple-moments.js';

const winIt = process.platform === 'win32' ? it : it.skip;

winIt('F04: a real Windows process exit preserves a paired read-only Twitch receipt without a second POST', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sc3-f04-restart-'));
  const file = join(directory, 'streamcockpit-moments.sqlite');
  const legacy = join(directory, 'streamcockpit-moments.json');
  const confirmationId = randomUUID();
  const moment = {
    sessionId: 'stream_123', instant: 1793750000000, source: 'twitch', correlationId: confirmationId,
    sourceEventId: 'twitch-clip-123', title: 'Clip Twitch demandé', status: 'observed',
    clip: { provider: 'twitch', reference: 'Clip123' },
  };
  let server: ReturnType<ReturnType<typeof express>['listen']> | undefined;
  try {
    // The writer exits without the test's cleanup path. A *different* process
    // opens the durable SQLite journal through the actual HTTP status router.
    const script = `import { MomentsPipeline } from './apps/server/src/streamcockpit-moments.ts';
      import { MomentsSqliteStorage } from './apps/server/src/streamcockpit-moments-sqlite.ts';
      await new MomentsPipeline(new MomentsSqliteStorage(${JSON.stringify(file)}, ${JSON.stringify(legacy)}))
        .record(${JSON.stringify(moment)});
      process.exit(73);`;
    const writer = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 12_000,
    });
    expect(writer.error).toBeUndefined();
    expect(writer.status, writer.stderr).toBe(73);
    expect(existsSync(file)).toBe(true);
    const pipeline = new MomentsPipeline(new MomentsSqliteStorage(file, legacy));
    const persisted = await pipeline.lookupTwitchMoment(confirmationId);
    expect(persisted).toMatchObject({ journalObserved: true,
      moment: { correlationId: confirmationId, source: 'twitch', status: 'observed', clip: { reference: 'Clip123' } } });

    const auth = new RemoteAuth();
    const pairing = auth.createPairing(undefined, true, ['chat', 'cloud', 'clips']);
    const paired = auth.pair(pairing.id, pairing.code, 'Test client');
    const externalCalls = vi.fn(async () => { throw Error('NO_PROVIDER_CALL_EXPECTED'); });
    const api = new SimpleMomentsTwitch(
      () => { throw Error('NO_PROVIDER_CREDENTIALS_EXPECTED'); }, externalCalls as typeof fetch,
    );
    const app = express(); app.use(express.json());
    app.use('/moment', createTwitchMomentRouter({
      api,
      actor: req => twitchMomentActor(req, auth, false, true),
      hostLive: () => '1:1',
      lookupReceipt: id => pipeline.lookupTwitchMoment(id),
    }));
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', resolve));

    const call = (route: string, method = 'GET', credential?: string, body?: unknown) => new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = httpRequest('http://127.0.0.1:' + (server!.address() as AddressInfo).port + '/moment/' + route,
        { method, headers: { 'Content-Type': 'application/json', ...(credential ? { authorization: 'Device ' + credential } : {}) } }, res => {
          const chunks: Buffer[] = [];
          res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
          res.on('end', () => {
            try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
            catch (error) { reject(error); }
          });
        });
      req.on('error', reject); req.setTimeout(5000, () => req.destroy(Error('TIMEOUT')));
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });

    const recovered = await call('status/' + confirmationId, 'GET', paired.credential);
    expect(recovered.status).toBe(200);
    expect(recovered.body).toMatchObject({
      kind: 'streamcockpit-moment-status', status: 'journal_observed', momentKind: 'clip',
      providerStatus: 'observed', retryable: false,
    });
    // A restarted router has no old single-use consent. Checking a receipt
    // must never recreate a clip, even if the client explicitly retries POST.
    const duplicate = await call('confirm', 'POST', paired.credential,
      { confirmationId, confirmed: true });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.retryable).toBe(false);
    expect(externalCalls).not.toHaveBeenCalled();
    const absent = await call('status/' + randomUUID(), 'GET', paired.credential);
    expect(absent.body).toMatchObject({ status: 'not_found_at_read', retryable: false });
    expect((await call('status/' + confirmationId)).status).toBe(503);
    auth.revoke(paired.deviceId);
    expect((await call('status/' + confirmationId, 'GET', paired.credential)).status).toBe(503);
    expect(externalCalls).not.toHaveBeenCalled();

    // Reading a receipt after restart must not mutate or replace its row.
    const reread = await new MomentsPipeline(new MomentsSqliteStorage(file, legacy)).lookupTwitchMoment(confirmationId);
    expect(reread).toEqual(persisted);
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server!.close(() => resolve()));
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
