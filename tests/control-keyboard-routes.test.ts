import express from 'express';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerControlRoutes } from '../apps/server/src/control-routes.js';
import { ControlService, type ControlAdapter } from '../apps/server/src/control-service.js';

const resources: { server: Server; control: ControlService; directory: string }[] = [];
afterEach(async () => {
  for (const { server, control, directory } of resources.splice(0)) {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await control.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'sd-keyboard-route-'));
  const file = join(directory, 'control.json');
  const adapter: ControlAdapter = {
    live: vi.fn(async () => false), output: vi.fn(async () => {}),
    metadata: vi.fn(async () => {}), action: vi.fn(async () => {}),
  };
  const control = await ControlService.open(file, adapter);
  const app = express();
  app.use(express.json());
  const unused: express.RequestHandler = (_req, res) => { res.sendStatus(204); };
  type Options = Parameters<typeof registerControlRoutes>[0];
  registerControlRoutes({
    app, control, wizebotCommands: {} as Options['wizebotCommands'],
    youtube: {} as Options['youtube'], obs: {} as Options['obs'],
    timerSource: () => undefined, state: () => ({}), observe: async () => {},
    settings: unused, planningCreate: unused, planningUpdate: unused,
    planningDelete: unused, recurrence: unused, isLocal: () => true, port: () => 0,
  });
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: { code: error.name, message: error.message } });
  });
  const server = createServer(app);
  resources.push({ server, control, directory });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP test server unavailable');
  const post = async (action: string, trigger?: string) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v2/actions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: randomUUID(), issuedAt: new Date().toISOString(), action, ...(trigger ? { trigger } : {}) }),
      signal: AbortSignal.timeout(5_000),
    });
    return { status: response.status, body: await response.json() };
  };
  const remapMicroToStop = async () => {
    const configuration = control.snapshot().configuration;
    const binding = configuration.actions.find(action => action.id === 'micro');
    if (!binding) throw new Error('Expected stock binding');
    binding.type = 'live.stop';
    await control.configure(configuration, configuration.revision);
  };
  return { control, adapter, file, post, remapMicroToStop };
}

describe('Keyboard action resolution on the authoritative server', () => {
  it('refuses both a stale custom binding now mapped to live.stop and a canonical keyboard stop before execute or any journal write', async () => {
    const { control, adapter, file, post, remapMicroToStop } = await harness();
    await remapMicroToStop();
    const saved = await readFile(file, 'utf8');
    const execute = vi.spyOn(control, 'execute');
    for (const action of ['micro', 'live.stop']) {
      expect(await post(action, 'keyboard')).toEqual({
        status: 409,
        body: { ok: false, error: { code: 'CONFIRM_REQUIRED', message: 'Confirmez l’arrêt depuis le bouton du tableau de bord.', retryable: false } },
      });
    }
    expect(execute).not.toHaveBeenCalled();
    expect(adapter.output).not.toHaveBeenCalled();
    expect(adapter.action).not.toHaveBeenCalled();
    expect(adapter.live).not.toHaveBeenCalled();
    expect(control.snapshot().receipts).toHaveLength(0);
    expect(await readFile(file, 'utf8')).toBe(saved);
  });

  it.each(['micro', 'scene-live', 'clip-save'])('preserves ordinary keyboard macro execution for %s', async action => {
    const { control, adapter, post } = await harness();
    const expected = control.snapshot().configuration.actions.find(binding => binding.id === action);
    expect(expected).toBeDefined();
    const result = await post(action, 'keyboard');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ action, status: 'succeeded' });
    expect(adapter.action).toHaveBeenCalledExactlyOnceWith(expected, result.body.id);
    expect(adapter.output).not.toHaveBeenCalled();
    expect(control.snapshot().receipts).toHaveLength(1);
  });

  it.each([
    ['micro', undefined], ['live.stop', undefined], ['micro', 'button'],
  ] as const)('preserves explicit stop for %s with trigger %s', async (action, trigger) => {
    const { control, adapter, post, remapMicroToStop } = await harness();
    await remapMicroToStop();
    const result = await post(action, trigger);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ action: 'live.stop', status: 'succeeded' });
    expect(vi.mocked(adapter.output).mock.calls).toEqual([['twitch', false], ['youtube', false]]);
    expect(adapter.action).not.toHaveBeenCalled();
    expect(control.snapshot().receipts).toHaveLength(1);
  });
});
