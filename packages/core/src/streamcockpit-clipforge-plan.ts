/** Offline contracts. Authorization and measured media metadata come from the host, never the client. */
export interface ClipSegment {
  startMs: number;
  endMs: number;
  fit: 'crop' | 'pad';
  captions?: { startMs: number; endMs: number; text: string }[];
}
export interface MediaMetrics { durationMs: number; width: number; height: number }
export const CLIP_LIMITS = Object.freeze({ sourceBytes: 512 * 1024 * 1024, outputBytes: 64 * 1024 * 1024,
  durationMs: 120_000, wallMs: 180_000, cpuSeconds: 120, memoryBytes: 1024 * 1024 * 1024, threads: 1 });
export function check(ok: unknown, code = 'INVALID'): asserts ok {
  if (!ok) throw new Error(`CLIPFORGE_${code}`);
}
export function metrics(value: MediaMetrics): MediaMetrics {
  check(value && Number.isSafeInteger(value.durationMs) && value.durationMs > 0 && value.durationMs <= 86_400_000);
  for (const n of [value.width, value.height]) check(Number.isSafeInteger(n) && n >= 16 && n <= 8192);
  return { durationMs: value.durationMs, width: value.width, height: value.height };
}
function time(ms: number): string {
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
export function planClip(segment: ClipSegment, measured: MediaMetrics) {
  const source = metrics(measured);
  check(segment && Object.keys(segment).every(k => ['startMs', 'endMs', 'fit', 'captions'].includes(k)));
  const { startMs, endMs, fit } = segment;
  check(Number.isSafeInteger(startMs) && Number.isSafeInteger(endMs) && startMs >= 0 && endMs > startMs && endMs <= source.durationMs && endMs - startMs <= CLIP_LIMITS.durationMs);
  check(fit === 'crop' || fit === 'pad');
  const captions = segment.captions ?? [];
  check(Array.isArray(captions) && captions.length <= 100);
  let previousEnd = 0;
  const normalized = captions.map(c => {
    check(c && Object.keys(c).every(k => ['startMs', 'endMs', 'text'].includes(k)));
    check(Number.isSafeInteger(c.startMs) && Number.isSafeInteger(c.endMs) && c.startMs >= previousEnd && c.endMs > c.startMs && c.endMs <= endMs - startMs);
    check(typeof c.text === 'string' && c.text.length > 0 && c.text.length <= 200 && !/[<>\r\n\x00-\x1f]/.test(c.text));
    previousEnd = c.endMs;
    return { startMs: c.startMs, endMs: c.endMs, text: c.text };
  });
  const filter = fit === 'crop'
    ? 'scale=360:640:force_original_aspect_ratio=increase,crop=360:640,setsar=1'
    : 'scale=360:640:force_original_aspect_ratio=decrease,pad=360:640:(ow-iw)/2:(oh-ih)/2,setsar=1';
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_threads', '1',
    '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm', '-i', '/proc/self/fd/3',
    '-ss', (startMs / 1000).toFixed(3), '-t', ((endMs - startMs) / 1000).toFixed(3),
    '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-map_chapters', '-1',
    '-vf', filter, '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-fs', String(CLIP_LIMITS.outputBytes),
    '-movflags', '+frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:4'];
  return { source, segment: { startMs, endMs, fit, captions: normalized }, width: 360, height: 640,
    args, vtt: normalized.length ? `WEBVTT\n\n${normalized.map(c => `${time(c.startMs)} --> ${time(c.endMs)}\n${c.text}\n`).join('\n')}` : null };
}
