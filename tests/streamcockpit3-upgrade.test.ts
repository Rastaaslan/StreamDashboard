import { describe, expect, it, vi } from 'vitest';
import { createDesktopUpgradePlanner } from '../apps/desktop/src/streamcockpit-upgrade.js';
import { migrateUpgradeData, type UpgradeAdapters, type UpgradeData, type UpgradeJournal, type UpgradeManifest, type UpgradeOperation, type UpgradeReceipt } from '../packages/core/src/streamcockpit-upgrade.js';

const manifest: UpgradeManifest = {
  id: 'desktop-3.0.0', version: '3.0.0', fromVersion: '2.1.0-rc.2', target: 'desktop',
  source: 'https://updates.example.test/release', sha256: 'a'.repeat(64),
  signature: { keyId: 'test-only', value: 'not-a-real-signature' }, schema: { from: 1, to: 2 },
};
function fixture() {
  let stored: UpgradeJournal | undefined;
  let tail = Promise.resolve();
  const receipts = new Map<string, UpgradeReceipt>();
  const action = (operation: UpgradeOperation) => vi.fn(async (...args: unknown[]) => {
    const key = args.at(-1) as string;
    const receipt = { reference: `${operation}-confirmed` };
    receipts.set(key, receipt);
    return receipt;
  });
  const assess = vi.fn(async (): Promise<{ safe: boolean; reason?: string }> => ({ safe: true }));
  const adapters = {
    exclusive: async <T>(work: () => Promise<T>): Promise<T> => {
      const previous = tail;
      let unlock!: () => void;
      tail = new Promise<void>(resolve => { unlock = resolve; });
      await previous;
      try { return await work(); } finally { unlock(); }
    },
    read: vi.fn(async () => stored && structuredClone(stored)),
    write: vi.fn(async (journal: UpgradeJournal) => { stored = structuredClone(journal); }),
    verify: vi.fn(async () => true),
    stage: action('stage'), backup: action('backup'), migrate: action('migrate'),
    install: action('install'), rollback: action('rollback'),
    reconcile: vi.fn(async (_operation: UpgradeOperation, key: string) => receipts.get(key)),
  } satisfies Omit<UpgradeAdapters, 'requireSafe'>;
  const planner = () => createDesktopUpgradePlanner(adapters, { assessRestartSafety: assess });
  return { adapters, assess, planner, receipts, stored: () => structuredClone(stored!) };
}
async function registered() {
  const f = fixture();
  await f.planner().register(manifest, 'local-artifact');
  return f;
}

describe('offline staged upgrade planner', () => {
  it.each(['Twitch diffuse', 'OBS unknown', 'Enregistrement actif'])('defers without side effects for %s', async reason => {
    const f = await registered();
    f.assess.mockResolvedValue({ safe: false, reason });
    const result = await f.planner().install();
    expect(result.phase).toBe('deferred');
    expect(result.events.at(-1)?.message).toContain(reason);
    expect(f.adapters.stage).not.toHaveBeenCalled();
    expect(f.adapters.backup).not.toHaveBeenCalled();
    expect(f.adapters.install).not.toHaveBeenCalled();
  });
  it('fails closed on missing observations and failed observation reads', async () => {
    const f = await registered();
    f.assess.mockResolvedValueOnce(undefined as never).mockRejectedValueOnce(new Error('offline'));
    expect((await f.planner().install()).phase).toBe('deferred');
    expect((await f.planner().install()).phase).toBe('deferred');
    expect(f.adapters.install).not.toHaveBeenCalled();
  });
  it('stages and verifies without installing or migrating', async () => {
    const f = await registered();
    const result = await f.planner().prepare();
    expect(result.events.map(event => event.phase)).toEqual(['downloaded', 'staged', 'verified']);
    expect(f.adapters.install).not.toHaveBeenCalled();
    expect(f.adapters.backup).not.toHaveBeenCalled();
  });
  it('rejects unverified signatures and reverifies a previously prepared artifact', async () => {
    const f = await registered();
    await f.planner().prepare();
    f.adapters.verify.mockResolvedValue(false);
    expect((await f.planner().install()).phase).toBe('deferred');
    expect(f.adapters.verify).toHaveBeenCalledTimes(2);
    expect(f.adapters.backup).not.toHaveBeenCalled();
    expect(f.adapters.install).not.toHaveBeenCalled();
  });
  it('rechecks live state after backup and migration; resumes without repeating effects', async () => {
    const f = await registered();
    f.assess.mockResolvedValueOnce({ safe: true }).mockResolvedValueOnce({ safe: false, reason: 'Live démarré' });
    expect((await f.planner().install()).phase).toBe('deferred');
    expect(f.adapters.install).not.toHaveBeenCalled();
    expect((await f.planner().install()).phase).toBe('installed');
    expect(f.adapters.backup).toHaveBeenCalledTimes(1);
    expect(f.adapters.migrate).toHaveBeenCalledTimes(1);
    expect(f.adapters.install).toHaveBeenCalledTimes(1);
  });
  it('refuses a live starting during the durable install-intent write', async () => {
    const f = await registered();
    const write = f.adapters.write.getMockImplementation()!;
    f.adapters.write.mockImplementation(async journal => {
      await write(journal);
      if (journal.pending?.operation === 'install') f.assess.mockResolvedValue({ safe: false, reason: 'Live pendant écriture' });
    });
    expect((await f.planner().install()).phase).toBe('deferred');
    expect(f.adapters.install).not.toHaveBeenCalled();
    expect(f.stored().pending).toBeUndefined();
  });
  it('preserves a simulated snapshot through install and explicit restoration', async () => {
    const f = await registered();
    const original: UpgradeData = { schemaVersion: 1, associations: { phone: 'fixture' }, profiles: { fixe: 'stream' } };
    let active = structuredClone(original);
    let backup: UpgradeData;
    let migrated: UpgradeData;
    f.adapters.backup.mockImplementation(async () => {
      backup = structuredClone(active); return { reference: 'snapshot' };
    });
    f.adapters.migrate.mockImplementation(async () => {
      migrated = migrateUpgradeData(backup, 2, [{ from: 1, to: 2, apply: copy => ({ ...copy, schemaVersion: 2 }) }]);
      return { reference: 'copy' };
    });
    f.adapters.install.mockImplementation(async () => {
      active = structuredClone(migrated); return { reference: 'read-back' };
    });
    f.adapters.rollback.mockImplementation(async () => {
      active = structuredClone(backup); return { reference: 'restored-read-back' };
    });
    expect((await f.planner().install()).phase).toBe('installed');
    expect(active).toEqual({ ...original, schemaVersion: 2 });
    expect((await f.planner().rollback()).phase).toBe('rolledBack');
    expect(active).toEqual(original);
  });
  it('serializes concurrent planners and keeps registration and terminal calls idempotent', async () => {
    const f = await registered();
    await f.planner().register(manifest, 'local-artifact');
    await Promise.all([f.planner().install(), f.planner().install()]);
    const before = f.stored();
    expect(await f.planner().install()).toEqual(before);
    expect(f.adapters.install).toHaveBeenCalledTimes(1);
    expect(before.events.map(event => event.sequence)).toEqual(before.events.map((_, index) => index + 1));
    await expect(f.planner().register({ ...manifest, version: '3.0.1' }, 'local-artifact')).rejects.toThrow('contrat');
  });
  it.each(['stage', 'backup', 'migrate', 'install'] as const)('blocks uncertain %s after a crash without replay', async operation => {
    const f = await registered();
    f.adapters[operation].mockRejectedValueOnce(new Error('crash'));
    expect((await f.planner().install()).phase).toBe('deferred');
    expect(f.stored().pending?.operation).toBe(operation);
    const resumed = await f.planner().install();
    expect(resumed.phase).toBe('deferred');
    expect(resumed.events.at(-1)?.message).toContain('incertaine');
    expect(f.adapters[operation]).toHaveBeenCalledTimes(1);
    expect((await f.planner().install()).events).toEqual(resumed.events);
  });
  it('recovers confirmed installation after completion-write crash without reinstalling', async () => {
    const f = await registered();
    const write = f.adapters.write.getMockImplementation()!;
    let failed = false;
    f.adapters.write.mockImplementation(async journal => {
      if (journal.installed && !failed) { failed = true; throw new Error('disk crash'); }
      return write(journal);
    });
    expect((await f.planner().install()).phase).toBe('deferred');
    expect(f.stored().pending?.operation).toBe('install');
    expect((await f.planner().install()).phase).toBe('installed');
    expect(f.adapters.install).toHaveBeenCalledTimes(1);
  });
  it('never executes an effect if its write-ahead intent cannot be saved', async () => {
    const f = await registered();
    f.adapters.write.mockRejectedValue(new Error('disk full'));
    await expect(f.planner().install()).rejects.toThrow('disk full');
    expect(f.adapters.stage).not.toHaveBeenCalled();
  });
  it('does not claim installed without a durable confirmation', async () => {
    const f = await registered();
    f.adapters.install.mockResolvedValueOnce({ reference: '' });
    expect((await f.planner().install()).phase).toBe('deferred');
    expect(f.stored().installed).toBe(false);
    expect(f.stored().pending?.operation).toBe('install');
  });
  it('restores explicit backup with safety checks and idempotent confirmation', async () => {
    const f = await registered();
    await f.planner().install();
    f.assess.mockResolvedValueOnce({ safe: false, reason: 'OBS unknown' });
    expect((await f.planner().rollback()).phase).toBe('deferred');
    expect(f.adapters.rollback).not.toHaveBeenCalled();
    const result = await f.planner().rollback();
    expect(result.phase).toBe('rolledBack');
    expect(f.adapters.rollback.mock.calls[0][0]).toMatchObject({ backup: 'backup-confirmed' });
    expect(await f.planner().rollback()).toEqual(result);
    expect(await f.planner().install()).toEqual(result);
    expect(f.adapters.rollback).toHaveBeenCalledTimes(1);
  });
  it('blocks rollback without backup and after an uncertain install', async () => {
    const f = await registered();
    expect((await f.planner().rollback()).phase).toBe('deferred');
    f.adapters.install.mockRejectedValueOnce(new Error('crash'));
    await f.planner().install();
    expect((await f.planner().rollback()).events.at(-1)?.message).toContain('incertaine');
    expect(f.adapters.rollback).not.toHaveBeenCalled();
  });
  it('reconciles a rollback crash without replaying restoration', async () => {
    const f = await registered();
    await f.planner().install();
    f.adapters.rollback.mockImplementationOnce(async (...args: unknown[]) => {
      f.receipts.set(args.at(-1) as string, { reference: 'restored' });
      throw new Error('crash after restore');
    });
    expect((await f.planner().rollback()).phase).toBe('deferred');
    expect((await f.planner().rollback()).phase).toBe('rolledBack');
    expect(f.adapters.rollback).toHaveBeenCalledTimes(1);
  });
  it.each([
    { source: 'http://updates.example.test' }, { sha256: 'invalid' },
    { signature: { keyId: '', value: '' } }, { version: manifest.fromVersion },
    { schema: { from: 2, to: 1 } }, { target: 'youtube' },
  ])('rejects invalid contract %j before journaling', async patch => {
    const f = fixture();
    await expect(f.planner().register({ ...manifest, ...patch } as UpgradeManifest, 'local')).rejects.toThrow();
    expect(f.adapters.write).not.toHaveBeenCalled();
  });
});

describe('versioned copy migration', () => {
  const snapshot = { schemaVersion: 1, associations: { android: { id: 'pairing-fixture' } }, profiles: { fixe: { role: 'stream' } }, other: ['preserved'] };
  it('preserves associations, profiles, extra data and immutable original through contiguous steps', () => {
    const before = structuredClone(snapshot);
    const migrated = migrateUpgradeData(snapshot, 3, [
      { from: 1, to: 2, apply: copy => ({ ...copy, schemaVersion: 2, newSetting: true }) },
      { from: 2, to: 3, apply: copy => ({ ...copy, schemaVersion: 3 }) },
    ]);
    expect(snapshot).toEqual(before);
    expect(migrated).toEqual({ ...snapshot, schemaVersion: 3, newSetting: true });
    expect(migrated.profiles).not.toBe(snapshot.profiles);
  });
  it('rejects loss of pairings/profiles and leaves backup untouched', () => {
    expect(() => migrateUpgradeData(snapshot, 2, [{ from: 1, to: 2, apply: copy => {
      copy.associations = {}; copy.schemaVersion = 2; return copy;
    } }])).toThrow('associations');
    expect(snapshot.associations.android.id).toBe('pairing-fixture');
  });
  it('refuses missing, ambiguous and incorrectly versioned migrations', () => {
    const step = { from: 1, to: 2, apply: (copy: UpgradeData) => copy };
    expect(() => migrateUpgradeData(snapshot, 2, [])).toThrow('manquante');
    expect(() => migrateUpgradeData(snapshot, 2, [step, step])).toThrow('ambiguë');
    expect(() => migrateUpgradeData(snapshot, 2, [step])).toThrow('Migration');
  });
});
