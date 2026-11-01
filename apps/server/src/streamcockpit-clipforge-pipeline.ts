import { constants } from 'node:fs';
import { open, lstat, realpath, statfs } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, parse, relative, resolve } from 'node:path';
import { check, CLIP_LIMITS, metrics, planClip, type ClipSegment, type MediaMetrics } from '../../../packages/core/src/streamcockpit-clipforge-plan.js';

export interface ClipExecutor {
  /** Must stop all work before settling; reject on lost connection/unknown termination. No retries. */
  probe(sourceFd: number, signal: AbortSignal): Promise<MediaMetrics>;
  encode(args: readonly string[], sourceFd: number, outputFd: number, signal: AbortSignal): Promise<{ exitCode: number | null }>;
}
export interface SourceGrant { relativePath: string; sha256: string }
export type ClipResult = { status: 'PREPARED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN'; code: string; manifest?: string };

// Linux directory descriptors pin every ancestor, including during rename/symlink races.
async function directory(path: string): Promise<FileHandle> {
  check(process.platform === 'linux' && isAbsolute(path) && resolve(path) === path, 'DIRECTORY');
  let fd = await open(parse(path).root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const part of path.split('/').filter(Boolean)) {
      const next = await open(`/proc/self/fd/${fd.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await fd.close(); fd = next;
    }
    return fd;
  } catch (e) { await fd.close(); throw e; }
}
async function digest(fd: FileHandle, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256'); const buffer = Buffer.alloc(65536); let position = 0;
  while (true) {
    check(!signal.aborted, 'CANCELLED');
    const { bytesRead } = await fd.read(buffer, 0, buffer.length, position);
    if (!bytesRead) break;
    position += bytesRead; check(position <= CLIP_LIMITS.sourceBytes, 'SOURCE_LIMIT'); hash.update(buffer.subarray(0, bytesRead));
  }
  return hash.digest('hex');
}
async function writeDurable(path: string, content: string) {
  const fd = await open(path, 'wx', 0o600);
  try { await fd.writeFile(content); await fd.sync(); } finally { await fd.close(); }
}

/** Dedicated private output directory and an explicit host-issued grant are mandatory.
 * A reservation is permanent: after any interruption, same jobId returns UNKNOWN, never re-encodes.
 * No cleanup deletes user data; retention and manual reconciliation belong to the host.
 */
export class ClipForge {
  private busy = false;
  constructor(private readonly sourceRoot: string, private readonly outputRoot: string, private readonly executor: ClipExecutor) {}
  async prepare(jobId: string, grant: SourceGrant, segment: ClipSegment, signal = new AbortController().signal): Promise<ClipResult> {
    if (this.busy) return { status: 'FAILED', code: 'BUSY' };
    this.busy = true;
    const handles: FileHandle[] = [];
    let reserved = false; let executing = false;
    const control = new AbortController();
    const cancel = () => control.abort(); signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const timeout = setTimeout(cancel, CLIP_LIMITS.wallMs);
    try {
      check(typeof jobId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(jobId), 'JOB');
      check(grant && /^[a-f0-9]{64}$/.test(grant.sha256), 'GRANT');
      check(typeof grant.relativePath === 'string' && grant.relativePath.length <= 512 &&
        grant.relativePath.split('/').every(p => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(p)), 'PATH');
      // Capture values before asynchronous calls; callers cannot change a pending grant/segment.
      const authorized = { ...grant }; const requested = structuredClone(segment);
      const sourceRoot = await directory(this.sourceRoot); handles.push(sourceRoot);
      const outputRoot = await directory(this.outputRoot); handles.push(outputRoot);
      const sourceReal = await realpath(`/proc/self/fd/${sourceRoot.fd}`);
      const outputReal = await realpath(`/proc/self/fd/${outputRoot.fd}`);
      const inside = (a: string, b: string) => { const r = relative(a, b); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
      check(!inside(sourceReal, outputReal) && !inside(outputReal, sourceReal), 'ROOT_OVERLAP');
      const os = await outputRoot.stat();
      check(os.uid === process.getuid?.() && (os.mode & 0o077) === 0, 'OUTPUT_PRIVATE');
      let parent = sourceRoot;
      const parts = authorized.relativePath.split('/');
      for (const part of parts.slice(0, -1)) {
        parent = await open(`/proc/self/fd/${parent.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); handles.push(parent);
      }
      const source = await open(`/proc/self/fd/${parent.fd}/${parts.at(-1)}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); handles.push(source);
      const before = await source.stat();
      check(before.isFile() && before.size > 0 && before.size <= CLIP_LIMITS.sourceBytes, 'SOURCE');
      check(await digest(source, control.signal) === authorized.sha256, 'UNAUTHORIZED');
      const plan = planClip(requested, await this.executor.probe(source.fd, control.signal));
      check(!control.signal.aborted, 'CANCELLED');
      const space = await statfs(`/proc/self/fd/${outputRoot.fd}`);
      check(space.bavail * space.bsize >= CLIP_LIMITS.outputBytes + 1024 * 1024, 'DISK');
      const base = `/proc/self/fd/${outputRoot.fd}/${jobId}`;
      // Existing artifacts are not proof of success, even if a previous run wrote a manifest.
      for (const suffix of ['.intent', '.mp4', '.json', '.vtt']) {
        try { await lstat(base + suffix); return { status: 'UNKNOWN', code: 'EXISTING_JOB' }; }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      }
      try { await writeDurable(base + '.intent', '{"state":"UNKNOWN","version":1}\n'); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return { status: 'UNKNOWN', code: 'EXISTING_JOB' }; throw e; }
      reserved = true; await outputRoot.sync();
      const output = await open(base + '.mp4', constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600); handles.push(output);
      executing = true;
      const receipt = await this.executor.encode(plan.args, source.fd, output.fd, control.signal);
      executing = false;
      if (control.signal.aborted) return { status: 'CANCELLED', code: 'ABORTED' };
      if (receipt.exitCode === null) return { status: 'UNKNOWN', code: 'NO_EXIT_RECEIPT' };
      check(receipt.exitCode === 0, 'ENCODER_EXIT');
      const resultStat = await output.stat();
      check(resultStat.isFile() && resultStat.size > 0 && resultStat.size < CLIP_LIMITS.outputBytes, 'OUTPUT_SIZE');
      const actual = metrics(await this.executor.probe(output.fd, control.signal));
      check(actual.width === plan.width && actual.height === plan.height && Math.abs(actual.durationMs - (requested.endMs - requested.startMs)) <= 250, 'OUTPUT_METRICS');
      const after = await source.stat();
      check(before.nlink === after.nlink && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && await digest(source, control.signal) === authorized.sha256, 'SOURCE_CHANGED');
      await output.sync();
      const manifest = JSON.stringify({ schemaVersion: 1, kind: 'streamcockpit-clipforge', sourceSha256: authorized.sha256,
        source: plan.source, segment: plan.segment, output: { file: `${jobId}.mp4`, width: plan.width, height: plan.height,
          bytes: resultStat.size, sha256: await digest(output, control.signal) },
        captions: plan.vtt ? `${jobId}.vtt` : null, markers: 'not-created-or-confirmed' }, null, 2) + '\n';
      if (plan.vtt) await writeDurable(base + '.vtt', plan.vtt);
      check(!control.signal.aborted, 'CANCELLED');
      await writeDurable(base + '.json', manifest); await outputRoot.sync();
      return { status: 'PREPARED', code: 'VERIFIED_LOCAL_OUTPUT', manifest };
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      const code = /^CLIPFORGE_[A-Z_]+$/.test(message) ? message.slice(10) : 'IO_OR_ADAPTER';
      return { status: executing ? 'UNKNOWN' : control.signal.aborted ? 'CANCELLED' : reserved && code === 'IO_OR_ADAPTER' ? 'UNKNOWN' : 'FAILED', code };
    } finally {
      clearTimeout(timeout); signal.removeEventListener('abort', cancel);
      await Promise.all(handles.reverse().map(fd => fd.close().catch(() => undefined))); this.busy = false;
    }
  }
}
