import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';

test('Electron démarre le backend, affiche le cockpit et l’arrête', async () => {
  const application = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, NODE_ENV: 'test' } });
  const window = await application.firstWindow();
  await expect(window).toHaveTitle(/StreamDashboard/);
  await expect(window.locator('h1')).toContainText("Vue d'ensemble");
  const health = await window.evaluate(() => fetch('/api/v1/health').then(response => response.json()));
  expect(health).toMatchObject({ ok: true, protocolVersion: 1 });
  const pid = application.process().pid;
  await application.close();
  expect(application.process().exitCode).not.toBeNull();
  expect(pid).toBeGreaterThan(0);
});
