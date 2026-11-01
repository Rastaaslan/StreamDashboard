import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preflightDesktopUpgrade, type DesktopUpgradePreflightDependencies, type UpgradeReleaseEvidence } from '../apps/desktop/src/streamcockpit-upgrade-preflight.js';
import { createDesktopUpgradePlanner } from '../apps/desktop/src/streamcockpit-upgrade.js';
import { migrateUpgradeData, type UpgradeAdapters, type UpgradeJournal, type UpgradeManifest } from '../packages/core/src/streamcockpit-upgrade.js';

const manifest: UpgradeManifest = {
  id: 'release-windows', version: '3.0.0', fromVersion: '2.1.0', target: 'desktop',
  source: 'https://example.test/windows', sha256: 'a'.repeat(64),
  signature: { keyId: 'fixture', value: 'fixture-only' }, schema: { from: 1, to: 2 },
};
function fixture() {
  const windows = { manifest: structuredClone(manifest), revision: 'b'.repeat(40), applicationId: 'windows-fixture', signer: 'windows-cert-fixture', staged: '/fixture/windows' };
  const evidence: UpgradeReleaseEvidence = {
    windows,
    android: { ...windows, manifest: { ...structuredClone(manifest), id: 'release-android', target: 'android' }, applicationId: 'android-fixture', signer: 'android-cert-fixture', staged: '/fixture/android' },
    installed: { windowsId: windows.applicationId, androidId: 'android-fixture', windowsSigner: windows.signer, androidSigner: 'android-cert-fixture', windowsVersion: '2.1.0', androidVersion: '2.1.0' },
    journal: { manifest: structuredClone(manifest), artifact: '/fixture/download', staged: windows.staged, phase: 'verified', events: [], installed: false, rolledBack: false },
  };
  const observation = { authority: 'fixe-agent' as const, session: 'boot-1', observedAt: 10_000, obs: 'idle' as const, twitch: 'offline' as const };
  const deps = {
    assessRestartSafety: vi.fn(async () => ({ safe: true })),
    observe: vi.fn(async () => observation), evidence: vi.fn(async () => evidence),
    verifyRelease: vi.fn(async () => true), now: () => 10_000,
  } satisfies DesktopUpgradePreflightDependencies;
  return { deps, evidence, observation };
}
describe('Windows preflight is read-only and fail-closed', () => {
  it('never grants launch even with every injected proof accepted', async () => {
    const f = fixture();
    expect(await preflightDesktopUpgrade(f.deps)).toMatchObject({ state: 'blocked', launchAllowed: false, releaseVerified: true });
    expect(f.deps.observe).toHaveBeenCalledTimes(2);
  });
  it.each(['live', 'unknown'] as const)('rejects OBS and Twitch %s', async state => {
    for (const source of ['obs', 'twitch'] as const) {
      const f = fixture();
      f.deps.observe.mockResolvedValue({ ...f.observation, [source]: state } as never);
      expect((await preflightDesktopUpgrade(f.deps)).releaseVerified).toBe(false);
      expect(f.deps.verifyRelease).not.toHaveBeenCalled();
    }
  });
  it.each([undefined, 0, 10_001, NaN])('rejects missing/stale/future timestamp %s', async observedAt => {
    const f = fixture();
    f.deps.observe.mockResolvedValue({ ...f.observation, observedAt } as never);
    expect((await preflightDesktopUpgrade(f.deps)).releaseVerified).toBe(false);
  });
  it.each([NaN, Infinity, -Infinity])('rejects non-finite local clock %s before release verification', async now => {
    const f = fixture();
    f.deps.now = () => now;
    const report = await preflightDesktopUpgrade(f.deps);
    expect(report).toMatchObject({ state: 'blocked', launchAllowed: false, releaseVerified: false });
    expect(f.deps.verifyRelease).not.toHaveBeenCalled();
  });
  it('refuses disconnected observations and absent providers', async () => {
    const f = fixture();
    f.deps.observe.mockRejectedValue(new Error('disconnected'));
    expect((await preflightDesktopUpgrade(f.deps)).releaseVerified).toBe(false);
    expect((await preflightDesktopUpgrade({ assessRestartSafety: f.deps.assessRestartSafety })).releaseVerified).toBe(false);
  });
  it('rejects Agent restart and live starting during verification', async () => {
    for (const final of [{ session: 'boot-2' }, { twitch: 'live' }]) {
      const f = fixture();
      f.deps.observe.mockResolvedValueOnce(f.observation).mockResolvedValueOnce({ ...f.observation, ...final } as never);
      expect((await preflightDesktopUpgrade(f.deps)).releaseVerified).toBe(false);
    }
  });
  it.each(['revision', 'signer', 'applicationId'] as const)('rejects divergent Android %s', async field => {
    const f = fixture(); f.evidence.android[field] = 'c'.repeat(40);
    expect((await preflightDesktopUpgrade(f.deps)).releaseVerified).toBe(false);
    expect(f.deps.verifyRelease).not.toHaveBeenCalled();
  });
  it('rejects missing signatures, verifier, invalid signatures and failed verification', async () => {
    const f = fixture(); f.evidence.android.manifest.signature.value = '';
    expect((await preflightDesktopUpgrade(f.deps)).releaseVerified).toBe(false);
    const g = fixture();
    expect((await preflightDesktopUpgrade({ ...g.deps, verifyRelease: undefined })).releaseVerified).toBe(false);
    g.deps.verifyRelease.mockResolvedValue(false);
    expect((await preflightDesktopUpgrade(g.deps)).releaseVerified).toBe(false);
    g.deps.verifyRelease.mockRejectedValue(new Error('invalid bytes'));
    expect((await preflightDesktopUpgrade(g.deps)).releaseVerified).toBe(false);
  });
  it.each(['assessRestartSafety', 'observe', 'evidence', 'verifyRelease'] as const)(
    'never displays or logs raw provider errors from %s', async provider => {
      const f = fixture();
      f.deps[provider].mockRejectedValue(new Error('Authorization: Bearer LEAK_SECRET_123'));
      const report = await preflightDesktopUpgrade(f.deps);
      expect(report).toMatchObject({ state: 'blocked', launchAllowed: false, releaseVerified: false });
      expect(report.reasons.join(' ')).not.toContain('LEAK_SECRET_123');
      expect(report.reasons.join(' ')).not.toContain('Bearer');
      expect(report.reasons.join(' ')).toContain('vérification non confirmée');
    },
  );
  it('refuses interrupted intent repeatedly without reconciliation or effects', async () => {
    const f = fixture(); f.evidence.journal.pending = { operation: 'install', key: 'uncertain' };
    const before = structuredClone(f.evidence);
    for (let i = 0; i < 3; i++) expect((await preflightDesktopUpgrade(f.deps)).releaseVerified).toBe(false);
    expect(f.evidence).toEqual(before);
    expect(f.deps.verifyRelease).not.toHaveBeenCalled();
  });
  it('refuses a journal for different staged bytes or a different manifest', async () => {
    const f = fixture(); f.evidence.journal.staged = '/other';
    expect((await preflightDesktopUpgrade(f.deps)).releaseVerified).toBe(false);
    f.evidence.journal.staged = f.evidence.windows.staged;
    f.evidence.journal.manifest.sha256 = 'c'.repeat(64);
    expect((await preflightDesktopUpgrade(f.deps)).releaseVerified).toBe(false);
  });
});

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
it.each([false, true])('temporary migration/rollback preserves data and fences uncertain replay (crash=%s)', async crash => {
  const dir = await mkdtemp(join(tmpdir(), 'lot-p-upgrade-')); directories.push(dir);
  const active = join(dir, 'active.json'), backup = join(dir, 'backup.json'), migrated = join(dir, 'migration.json'), journalPath = join(dir, 'journal.json');
  const original = { schemaVersion: 1, associations: { phone: 'synthetic' }, profiles: { fixe: 'synthetic' }, extra: 'keep' };
  await writeFile(active, JSON.stringify(original));
  const read = async () => JSON.parse(await readFile(journalPath, 'utf8')) as UpgradeJournal;
  const install = vi.fn(async () => {
    if (crash) throw new Error('simulated crash before receipt');
    await writeFile(active, await readFile(migrated));
    expect(JSON.parse(await readFile(active, 'utf8')).schemaVersion).toBe(2);
    return { reference: active };
  });
  const adapters: Omit<UpgradeAdapters, 'requireSafe'> = {
    // Single-process fixture only; not a production durability/locking implementation.
    exclusive: work => work(), read: async () => { try { return await read(); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; } },
    write: async journal => { await writeFile(journalPath, JSON.stringify(journal)); },
    verify: async () => true, stage: async () => ({ reference: 'fixture-staged' }),
    backup: async () => { await writeFile(backup, await readFile(active), { flag: 'wx' }); return { reference: backup }; },
    migrate: async () => {
      const data = JSON.parse(await readFile(backup, 'utf8'));
      const result = migrateUpgradeData(data, 2, [{ from: 1, to: 2, apply: copy => ({ ...copy, schemaVersion: 2 }) }]);
      await writeFile(migrated, JSON.stringify(result), { flag: 'wx' }); return { reference: migrated };
    },
    install, rollback: async () => { await writeFile(active, await readFile(backup)); return { reference: active }; },
    reconcile: async () => undefined,
  };
  const planner = () => createDesktopUpgradePlanner(adapters, { assessRestartSafety: async () => ({ safe: true }) });
  await planner().register(manifest, 'fixture');
  if (crash) {
    expect((await planner().install()).pending?.operation).toBe('install');
    expect((await planner().install()).phase).toBe('deferred');
    expect((await planner().rollback()).phase).toBe('deferred');
  } else {
    expect((await planner().install()).phase).toBe('installed');
    expect((await planner().install()).phase).toBe('installed');
    expect((await planner().rollback()).phase).toBe('rolledBack');
    expect((await planner().rollback()).phase).toBe('rolledBack');
  }
  expect(install).toHaveBeenCalledTimes(1);
  expect(JSON.parse(await readFile(active, 'utf8'))).toEqual(original);
  expect(JSON.parse(await readFile(backup, 'utf8'))).toEqual(original);
  expect(JSON.parse(await readFile(migrated, 'utf8'))).toEqual({ ...original, schemaVersion: 2 });
  expect((await readdir(dir)).sort()).toEqual(['active.json', 'backup.json', 'journal.json', 'migration.json']);
  expect(() => migrateUpgradeData(original, 2, [{ from: 1, to: 2, apply: copy => ({ ...copy, schemaVersion: 2, profiles: {} }) }])).toThrow();
  expect(JSON.parse(await readFile(active, 'utf8'))).toEqual(original);
});
