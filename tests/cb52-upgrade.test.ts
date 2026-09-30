import { it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startDashboardServer } from '../apps/server/src/index.js';

it.each([
  [{ modeScenes: { live: 'Gameplay' } }, 'live'],
  [{ modeScenes: { live: 'Gameplay', intro: 'Intro' } }, 'intro'],
  [{ startMode: 'intro', modeScenes: { live: 'Gameplay' } }, 'intro'],
  [{ startMode: 'live', modeScenes: { live: 'Gameplay', intro: 'Intro' } }, 'live'],
] as const)('upgrades old settings without changing explicit start choices: %j', async (settings, expected) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'cb52-upgrade-'));
  let runtime;
  try {
    await writeFile(path.join(dataDir, 'dashboard.json'), JSON.stringify({ settings }));
    runtime = await startDashboardServer({ port: 0, dataDir });
    expect(runtime.state().settings.startMode).toBe(expected);
    expect(runtime.state().settings.modeScenes).toEqual(settings.modeScenes);
    await runtime.stop();
    expect(JSON.parse(await readFile(path.join(dataDir, 'dashboard.json'), 'utf8')).settings.startMode).toBe(expected);
    runtime = await startDashboardServer({ port: 0, dataDir });
    expect(runtime.state().settings.startMode).toBe(expected);
  } finally { await runtime?.stop(); await rm(dataDir, { recursive: true, force: true }); }
});
