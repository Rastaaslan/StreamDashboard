import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
// Exercise the real persistent store; only the OS-owned Electron primitive is mocked.
vi.mock('electron', async () => {
  const { createCipheriv, createDecipheriv, randomBytes } = await import('node:crypto');
  const key = randomBytes(32);
  return { safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString(value: string) {
      const iv = randomBytes(16), cipher = createCipheriv('aes-256-cbc', key, iv);
      return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final()]);
    },
    decryptString(value: Buffer) {
      const cipher = createDecipheriv('aes-256-cbc', key, value.subarray(0, 16));
      return Buffer.concat([cipher.update(value.subarray(16)), cipher.final()]).toString('utf8');
    },
  } };
});
import { safeStorage } from 'electron';
import { ElectronSecretStore } from '../apps/desktop/src/secrets.js';
let directory = '';
afterEach(async () => { vi.restoreAllMocks(); if (directory) await rm(directory, { recursive: true, force: true }); });
it('persists Google app credential encrypted across instances and clears it independently of tokens', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'google-secure-'));
  const secret = 'google-storage-test-value';
  const store = new ElectronSecretStore(directory);
  await Promise.all([store.setGoogleClientSecret(secret), store.setGoogleTokens({ refreshToken: 'refresh' })]);
  expect((await readFile(path.join(directory, 'secure/credentials.dat'))).includes(Buffer.from(secret))).toBe(false);
  const restored = new ElectronSecretStore(directory);
  expect(await restored.getGoogleClientSecret()).toBe(secret);
  expect(await restored.getGoogleTokens()).toEqual({ refreshToken: 'refresh' });
  await restored.clearGoogleClientSecret();
  expect(await new ElectronSecretStore(directory).getGoogleClientSecret()).toBe('');
  expect(await restored.getGoogleTokens()).toEqual({ refreshToken: 'refresh' });
});
it('refuses to write Google credentials when OS encryption is unavailable', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'google-secure-'));
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
  await expect(new ElectronSecretStore(directory).setGoogleClientSecret('test-value')).rejects.toThrow('stockage sécurisé');
  await expect(readFile(path.join(directory, 'secure/credentials.dat'))).rejects.toMatchObject({ code: 'ENOENT' });
});
