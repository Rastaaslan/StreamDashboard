import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, chmod, open } from 'node:fs/promises';
import { writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ClipForge, type ClipExecutor } from '../apps/server/src/streamcockpit-clipforge-pipeline.js';
import { LinuxClipExecutor } from '../apps/server/src/streamcockpit-clipforge-executor.js';
import { CLIP_LIMITS, planClip, type MediaMetrics } from '../packages/core/src/streamcockpit-clipforge-plan.js';
const disk = vi.hoisted(() => ({ full: false }));
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, statfs: (...args: Parameters<typeof actual.statfs>) => disk.full ? Promise.resolve({ bavail: 0, bsize: 4096 }) : actual.statfs(...args) };
});
const sourceMetrics = { width: 1920, height: 1080, durationMs: 10_000 };
const outputMetrics = { width: 360, height: 640, durationMs: 2000 };
const segment = { startMs: 1000, endMs: 3000, fit: 'crop' as const };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
let root: string; let input: string; let output: string;
let executor: ClipExecutor; let calls: number;
const grant = { relativePath: 'source.mp4', sha256: hash('fixture-local-media') };
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clipforge-k-')); input = join(root, 'in'); output = join(root, 'out');
  await mkdir(input, { mode: 0o700 }); await mkdir(output, { mode: 0o700 }); await writeFile(join(input, 'source.mp4'), 'fixture-local-media');
  disk.full = false; calls = 0; let probes = 0;
  executor = { probe: async () => ++probes === 1 ? sourceMetrics : outputMetrics,
    encode: async (_args, _source, out) => { calls++; writeSync(out, 'synthetic-output'); return { exitCode: 0 }; } };
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
const pipeline = () => new ClipForge(input, output, executor);
describe('ClipForge offline', () => {
  it('creates a deterministic verified manifest and sidecar without altering source', async () => {
    const request = { ...segment, captions: [{ startMs: 0, endMs: 1000, text: 'Bonjour' }] };
    const result = await pipeline().prepare('one', grant, request);
    expect(result.status).toBe('PREPARED');
    expect(await readFile(join(output, 'one.json'), 'utf8')).toBe(result.manifest);
    expect(JSON.parse(result.manifest!).markers).toBe('not-created-or-confirmed');
    expect(await readFile(join(output, 'one.vtt'), 'utf8')).toContain('00:00:00.000 --> 00:00:01.000');
    expect(await readFile(join(input, 'source.mp4'), 'utf8')).toBe('fixture-local-media');
    expect(result.manifest).not.toContain(root);
    const other = join(root, 'other'); await mkdir(other, { mode: 0o700 });
    let probes = 0; executor.probe = async () => ++probes === 1 ? sourceMetrics : outputMetrics;
    expect((await new ClipForge(input, other, executor).prepare('one', grant, request)).manifest).toBe(result.manifest);
  });
  it.each(['../source.mp4', '/source.mp4', 'a/../../source.mp4', 'a\\source.mp4', 'file:source.mp4', 'a//source.mp4', 'x;touch x'])('rejects path %s', async path => {
    expect((await pipeline().prepare('one', { ...grant, relativePath: path }, segment)).status).toBe('FAILED'); expect(calls).toBe(0);
  });
  it.each(['leaf', 'ancestor', 'root'])('rejects hostile symlink %s', async where => {
    if (where === 'leaf') { await symlink(join(input, 'source.mp4'), join(input, 'link.mp4')); }
    if (where === 'ancestor') await symlink(input, join(input, 'link'));
    if (where === 'root') { await symlink(input, join(root, 'link')); input = join(root, 'link'); }
    const relativePath = where === 'leaf' ? 'link.mp4' : where === 'ancestor' ? 'link/source.mp4' : 'source.mp4';
    expect((await pipeline().prepare('one', { ...grant, relativePath }, segment)).status).toBe('FAILED'); expect(calls).toBe(0);
  });
  it('rejects missing source, wrong authorization and directories', async () => {
    for (const g of [{ ...grant, relativePath: 'missing.mp4' }, { ...grant, sha256: '0'.repeat(64) }, { ...grant, relativePath: 'folder' }]) {
      await mkdir(join(input, 'folder'), { recursive: true }); expect((await pipeline().prepare('one', g, segment)).status).toBe('FAILED');
    }
    expect(calls).toBe(0);
  });
  it.each([NaN, Infinity, -1, 0, 1.1, 90_000_000])('rejects invalid duration %s', n => {
    expect(() => planClip(segment, { ...sourceMetrics, durationMs: n })).toThrow();
  });
  it.each([{ startMs: -1 }, { endMs: 999999 }, { endMs: 1000 }, { startMs: NaN }, { fit: '9:9' }, { extra: 'token' }])('rejects invalid segment %j', patch => {
    expect(() => planClip({ ...segment, ...patch } as typeof segment, sourceMetrics)).toThrow();
  });
  it('validates geometry, duration limits and captions', () => {
    for (const width of [NaN, 0, 9000, 1.5]) expect(() => planClip(segment, { ...sourceMetrics, width })).toThrow();
    expect(() => planClip({ ...segment, startMs: 0, endMs: 120001 }, { ...sourceMetrics, durationMs: 200000 })).toThrow();
    for (const text of ['<script>', 'bad\ntext', '', 'a'.repeat(201)]) expect(() => planClip({ ...segment, captions: [{ startMs: 0, endMs: 100, text }] }, sourceMetrics)).toThrow();
    expect(() => planClip({ ...segment, captions: [{ startMs: 1000, endMs: 2001, text: 'x' }] }, sourceMetrics)).toThrow();
  });
  it('builds only fixed arguments, 9:16 pad/crop and single thread', () => {
    const plan = planClip({ ...segment, fit: 'pad', captions: [{ startMs: 0, endMs: 10, text: '$(touch injected); x' }] }, sourceMetrics);
    expect(plan.args.join(' ')).not.toContain('touch'); expect(plan.args).toContain('pipe:4');
    expect(plan.args).toContain('scale=360:640:force_original_aspect_ratio=decrease,pad=360:640:(ow-iw)/2:(oh-ih)/2,setsar=1');
    expect(CLIP_LIMITS.threads).toBe(1);
  });
  it.each(['.mp4', '.intent', '.json', '.vtt'])('refuses output collision %s without overwrite', async suffix => {
    await writeFile(join(output, `one${suffix}`), 'existing');
    expect((await pipeline().prepare('one', grant, segment)).status).toBe('UNKNOWN'); expect(calls).toBe(0);
    expect(await readFile(join(output, `one${suffix}`), 'utf8')).toBe('existing');
  });
  it('does not retry after encoder failure or after restart', async () => {
    executor.encode = async () => { calls++; return { exitCode: 9 }; };
    expect(await pipeline().prepare('one', grant, segment)).toMatchObject({ status: 'FAILED', code: 'ENCODER_EXIT' });
    executor.probe = async () => sourceMetrics;
    expect((await pipeline().prepare('one', grant, segment)).status).toBe('UNKNOWN'); expect(calls).toBe(1);
  });
  it.each(['missing', 'empty', 'oversized', 'metrics', 'lost', 'null'])('never claims success on %s', async mode => {
    executor.encode = async (_a, _s, fd) => {
      if (mode === 'lost') throw new Error('secret-token-in-adapter-error');
      if (mode === 'oversized') writeSync(fd, Buffer.from('x'), 0, 1, CLIP_LIMITS.outputBytes);
      if (mode === 'metrics') writeSync(fd, 'x');
      return { exitCode: mode === 'null' ? null : 0 };
    };
    if (mode === 'metrics') executor.probe = async () => sourceMetrics;
    const result = await pipeline().prepare('one', grant, segment);
    expect(result.status).toBe(['lost', 'null'].includes(mode) ? 'UNKNOWN' : 'FAILED');
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });
  it('rejects changed source even when encoder exits zero', async () => {
    executor.encode = async (_a, _s, fd) => { writeSync(fd, 'x'); await writeFile(join(input, 'source.mp4'), 'changed'); return { exitCode: 0 }; };
    expect(await pipeline().prepare('one', grant, segment)).toMatchObject({ status: 'FAILED', code: 'SOURCE_CHANGED' });
  });
  it('cancels before work and during encode; suppresses late success', async () => {
    const c = new AbortController(); c.abort();
    expect((await pipeline().prepare('before', grant, segment, c.signal)).status).toBe('CANCELLED'); expect(calls).toBe(0);
    const during = new AbortController(); executor.encode = async () => { during.abort(); return { exitCode: 0 }; };
    expect((await pipeline().prepare('during', grant, segment, during.signal)).status).toBe('CANCELLED');
  });
  it('rejects concurrent jobs on one instance', async () => {
    let release!: (m: MediaMetrics) => void; executor.probe = () => new Promise(r => { release = r; });
    const p = pipeline(); const pending = p.prepare('one', grant, segment);
    expect(await p.prepare('two', grant, segment)).toMatchObject({ code: 'BUSY' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release({ width: 0, height: 0, durationMs: 0 }); await pending;
  });
  it('reserves a job exclusively across independent instances', async () => {
    executor.probe = async fd => (await readFile(`/proc/self/fd/${fd}`, 'utf8')) === 'fixture-local-media' ? sourceMetrics : outputMetrics;
    const results = await Promise.all([pipeline().prepare('one', grant, segment), pipeline().prepare('one', grant, segment)]);
    expect(results.map(r => r.status).sort()).toEqual(['PREPARED', 'UNKNOWN']); expect(calls).toBe(1);
  });
  it('keeps output and reports UNKNOWN when manifest persistence cannot complete', async () => {
    executor.encode = async (_args, _source, fd) => {
      writeSync(fd, 'synthetic-output'); await writeFile(join(output, 'one.json'), 'foreign-existing'); return { exitCode: 0 };
    };
    expect((await pipeline().prepare('one', grant, segment)).status).toBe('UNKNOWN');
    expect(await readFile(join(output, 'one.json'), 'utf8')).toBe('foreign-existing');
    expect(await readFile(join(output, 'one.mp4'), 'utf8')).toBe('synthetic-output');
  });
  it('rejects insecure output directory, overlapping roots and oversized source', async () => {
    await chmod(output, 0o755); expect((await pipeline().prepare('one', grant, segment)).status).toBe('FAILED');
    await chmod(output, 0o700);
    expect((await new ClipForge(input, input, executor).prepare('one', grant, segment)).status).toBe('FAILED');
    const fd = await open(join(input, 'source.mp4'), 'r+'); await fd.truncate(CLIP_LIMITS.sourceBytes + 1); await fd.close();
    expect((await pipeline().prepare('one', grant, segment)).status).toBe('FAILED'); expect(calls).toBe(0);
  });
  it('rejects exhausted disk before reserving or executing', async () => {
    disk.full = true;
    expect(await pipeline().prepare('one', grant, segment)).toMatchObject({ status: 'FAILED', code: 'DISK' });
    expect(calls).toBe(0); await expect(readFile(join(output, 'one.intent'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('does not follow an output symlink or overwrite its target', async () => {
    await symlink(join(input, 'source.mp4'), join(output, 'one.mp4'));
    expect((await pipeline().prepare('one', grant, segment)).status).toBe('UNKNOWN');
    expect(calls).toBe(0); expect(await readFile(join(input, 'source.mp4'), 'utf8')).toBe('fixture-local-media');
  });
  it('pins source descriptors against replacement during probe', async () => {
    let probes = 0;
    executor.probe = async () => {
      if (++probes === 1) {
        await rm(join(input, 'source.mp4')); await symlink('/missing/hostile', join(input, 'source.mp4'));
        return sourceMetrics;
      }
      return outputMetrics;
    };
    // Unlink changes link count: refuse even when filesystem timestamp precision hides the change.
    expect((await pipeline().prepare('one', grant, segment)).status).toBe('FAILED');
  });
  it('stops on probe disconnection without rendering or leaking error details', async () => {
    executor.probe = async () => { throw new Error('Bearer synthetic-secret'); };
    expect(await pipeline().prepare('one', grant, segment)).toEqual({ status: 'FAILED', code: 'IO_OR_ADAPTER' });
    expect(calls).toBe(0);
  });
  it('fails closed when process resource launcher is absent', async () => {
    const e = new LinuxClipExecutor({ ffmpeg: '/missing/ffmpeg', ffprobe: '/missing/ffprobe', prlimit: '/missing/prlimit', nice: '/missing/nice', ionice: '/missing/ionice' });
    const fd = await open(join(input, 'source.mp4'), 'r');
    try { await expect(e.probe(fd.fd, new AbortController().signal)).rejects.toThrow('CLIPFORGE_EXECUTOR_UNAVAILABLE'); } finally { await fd.close(); }
  });
});
