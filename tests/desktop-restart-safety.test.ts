import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { persistDeviceRole, requireDesktopRestartSafety } from '../apps/desktop/src/restart-safety.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function profile() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-role-safety-'));
  directories.push(directory);
  const file = path.join(directory, 'device-role.json');
  const previous = JSON.stringify({ version: 1, role: 'stream', name: 'PC stream' });
  await writeFile(file, previous);
  return { directory, file, previous };
}
const next = { version: 1, role: 'control' as const, name: 'PC jeu' };

describe('desktop role changes preserve the last usable role until restart is safe', () => {
  it('keeps the existing file untouched when the initial live check refuses', async () => {
    const { directory, file, previous } = await profile();
    const assess = vi.fn(async () => ({ safe: false, reason: 'YouTube diffuse encore.' }));
    await expect(persistDeviceRole(file, next, () => requireDesktopRestartSafety(assess))).rejects.toThrow('YouTube diffuse encore');
    expect(await readFile(file, 'utf8')).toBe(previous);
    expect(await readdir(directory)).toEqual(['device-role.json']);
    expect(assess).toHaveBeenCalledTimes(1);
  });

  it('rechecks after preparing the file and discards it if a live began meanwhile', async () => {
    const { directory, file, previous } = await profile();
    const assess = vi.fn().mockResolvedValueOnce({ safe: true }).mockImplementationOnce(async () => {
      expect((await readdir(directory)).some(name => name.endsWith('.tmp'))).toBe(true);
      expect(await readFile(file, 'utf8')).toBe(previous);
      return { safe: false, reason: 'Sortie Aitum active.' };
    });
    await expect(persistDeviceRole(file, next, () => requireDesktopRestartSafety(assess))).rejects.toThrow('Sortie Aitum active');
    expect(await readFile(file, 'utf8')).toBe(previous);
    expect(await readdir(directory)).toEqual(['device-role.json']);
    expect(assess).toHaveBeenCalledTimes(2);
  });

  it('publishes the next role atomically after both independent observations pass', async () => {
    const { directory, file } = await profile();
    const assess = vi.fn(async () => ({ safe: true }));
    await persistDeviceRole(file, next, () => requireDesktopRestartSafety(assess));
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(next);
    expect(await readdir(directory)).toEqual(['device-role.json']);
    expect(assess).toHaveBeenCalledTimes(2);
  });

  it('allows a name-only change without requiring an OBS restart observation', async () => {
    const { file } = await profile();
    const renamed = { version: 1, role: 'stream' as const, name: 'Régie renommée' };
    await persistDeviceRole(file, renamed);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(renamed);
  });

  it('refuses missing or failed observers without exposing their internal error', async () => {
    await expect(requireDesktopRestartSafety()).rejects.toThrow('ne permet pas');
    await expect(requireDesktopRestartSafety(async () => { throw new Error('private backend detail'); })).rejects.toThrow('ne peut pas être vérifié');
  });
});
