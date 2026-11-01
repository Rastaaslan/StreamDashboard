import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it as vitestIt, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { LinuxClipExecutor } from '../apps/server/src/streamcockpit-clipforge-executor.js';
import { CLIP_LIMITS } from '../packages/core/src/streamcockpit-clipforge-plan.js';
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
// Linux resource launcher uses /proc and POSIX execution primitives; Windows must fail closed.
const it = process.platform === 'linux' ? vitestIt : vitestIt.skip;
const config = { nice: '/usr/bin/nice', ionice: '/usr/bin/ionice', prlimit: '/usr/bin/prlimit', ffmpeg: '/usr/bin/ffmpeg', ffprobe: '/usr/bin/ffprobe' };
function setup() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill: vi.fn() });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  return { child, executor: new LinuxClipExecutor(config) };
}
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
vitestIt.skipIf(process.platform !== 'win32')('Windows rejects Linux resource launcher without spawning FFmpeg', () => {
  expect(() => new LinuxClipExecutor(config)).toThrow('CLIPFORGE_BINARIES');
  expect(spawn).not.toHaveBeenCalled();
});
it('passes fixed resource limits, low priority, no shell or inherited secrets, pinned FDs', async () => {
  const { child, executor } = setup(); const pending = executor.encode(['-f', 'mp4', 'pipe:4'], 31, 32, new AbortController().signal);
  expect(spawn).toHaveBeenCalledWith(config.nice, expect.arrayContaining(['-n', '15', config.ionice, '-c', '3', config.prlimit,
    `--cpu=${CLIP_LIMITS.cpuSeconds}`, `--fsize=${CLIP_LIMITS.outputBytes}`, `--as=${CLIP_LIMITS.memoryBytes}`, '--core=0', config.ffmpeg]),
  { shell: false, env: { LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore', 31, 32] });
  child.emit('close', 7); expect(await pending).toEqual({ exitCode: 7 });
});
it('waits for close after cancellation and returns an uncertain termination', async () => {
  const { child, executor } = setup(); const c = new AbortController(); let settled = false;
  const pending = executor.encode([], 1, 2, c.signal).then(r => { settled = true; return r; });
  c.abort(); expect(child.kill).toHaveBeenCalledWith('SIGKILL'); await Promise.resolve(); expect(settled).toBe(false);
  child.emit('close', null); expect(await pending).toEqual({ exitCode: null });
});
it('kills on wall limit without silently retrying', async () => {
  vi.useFakeTimers(); const { child, executor } = setup();
  const pending = executor.encode([], 1, 2, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(CLIP_LIMITS.wallMs); expect(child.kill).toHaveBeenCalledOnce();
  child.emit('close', null); expect((await pending).exitCode).toBeNull(); expect(spawn).toHaveBeenCalledOnce();
});
it('bounds diagnostic output and discards raw errors', async () => {
  const { child, executor } = setup(); const pending = executor.probe(1, new AbortController().signal);
  child.stdout.write(Buffer.alloc(65537, 'x')); expect(child.kill).toHaveBeenCalledOnce();
  child.emit('close', null); await expect(pending).rejects.toThrow('CLIPFORGE_EXECUTOR_UNAVAILABLE');
});
it.each(['invalid json', '{"streams":[],"format":{"duration":"2"}}', '{"streams":[{"width":360,"height":640}],"format":{"duration":"NaN"}}'])('refuses invalid probe evidence %s', async json => {
  const { child, executor } = setup(); const pending = executor.probe(1, new AbortController().signal);
  child.stdout.write(json); child.emit('close', 0); await expect(pending).rejects.toThrow();
});
it('parses measured dimensions and duration', async () => {
  const { child, executor } = setup(); const pending = executor.probe(1, new AbortController().signal);
  child.stdout.write('{"streams":[{"width":360,"height":640}],"format":{"duration":"2.000"}}'); child.emit('close', 0);
  expect(await pending).toEqual({ width: 360, height: 640, durationMs: 2000 });
});
