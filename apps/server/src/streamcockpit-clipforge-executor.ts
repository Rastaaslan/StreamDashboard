import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { check, CLIP_LIMITS, metrics, type MediaMetrics } from '../../../packages/core/src/streamcockpit-clipforge-plan.js';
import type { ClipExecutor } from './streamcockpit-clipforge-pipeline.js';

export interface ClipBinaries { ffmpeg: string; ffprobe: string; prlimit: string; nice: string; ionice: string }
/** Linux only. Absolute executable paths must be supplied by trusted host configuration.
 * prlimit execs one child: no shell, inherited credentials, environment, stderr or network URL.
 * Missing resource tools fail closed. This is resource containment, not a codec security sandbox.
 */
export class LinuxClipExecutor implements ClipExecutor {
  private readonly binaries: ClipBinaries;
  constructor(binaries: ClipBinaries) {
    check(process.platform === 'linux' && Object.values(binaries).length === 5 && Object.values(binaries).every(p => typeof p === 'string' && isAbsolute(p)), 'BINARIES');
    this.binaries = { ...binaries };
  }
  private run(binary: string, args: readonly string[], input: number, output: number | undefined, signal: AbortSignal): Promise<{ exitCode: number | null; stdout: string }> {
    check(!signal.aborted, 'CANCELLED');
    return new Promise((resolve, reject) => {
      const child = spawn(this.binaries.nice, ['-n', '15', this.binaries.ionice, '-c', '3', this.binaries.prlimit,
        `--cpu=${CLIP_LIMITS.cpuSeconds}`, `--fsize=${CLIP_LIMITS.outputBytes}`, `--as=${CLIP_LIMITS.memoryBytes}`, '--core=0',
        '--', binary, ...args], { shell: false, env: { LANG: 'C', LC_ALL: 'C' },
        stdio: ['ignore', 'pipe', 'ignore', input, output ?? 'ignore'] });
      let text = ''; let overflow = false; let spawnFailed = false;
      const kill = () => child.kill('SIGKILL');
      signal.addEventListener('abort', kill, { once: true });
      const timer = setTimeout(kill, CLIP_LIMITS.wallMs);
      if (signal.aborted) kill();
      child.stdout?.on('data', (data: Buffer) => {
        if (Buffer.byteLength(text) + data.length > 65536) { overflow = true; kill(); }
        else text += data.toString('utf8');
      });
      child.on('error', () => { spawnFailed = true; });
      // close, not exit: the adapter never settles while the process still owns the output FD.
      child.on('close', exitCode => {
        clearTimeout(timer); signal.removeEventListener('abort', kill);
        if (spawnFailed || overflow) reject(new Error('CLIPFORGE_EXECUTOR_UNAVAILABLE'));
        else resolve({ exitCode, stdout: text });
      });
    });
  }
  async probe(sourceFd: number, signal: AbortSignal): Promise<MediaMetrics> {
    const result = await this.run(this.binaries.ffprobe, ['-v', 'error', '-threads', '1',
      '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm',
      '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', '/proc/self/fd/3'], sourceFd, undefined, signal);
    check(result.exitCode === 0, 'PROBE_FAILED');
    let parsed: { streams?: { width: number; height: number }[]; format?: { duration?: string } };
    try { parsed = JSON.parse(result.stdout); } catch { throw new Error('CLIPFORGE_PROBE_FAILED'); }
    check(parsed && parsed.streams?.length === 1 && typeof parsed.format?.duration === 'string', 'PROBE_FAILED');
    return metrics({ width: parsed.streams[0].width, height: parsed.streams[0].height, durationMs: Math.round(Number(parsed.format.duration) * 1000) });
  }
  async encode(args: readonly string[], sourceFd: number, outputFd: number, signal: AbortSignal) {
    const result = await this.run(this.binaries.ffmpeg, args, sourceFd, outputFd, signal);
    return { exitCode: result.exitCode };
  }
}
