import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const TTL_MS = 25_000;
export interface DjiBatteryTx {
  slot: 1 | 2;
  connected: boolean;
  rawGauge: number | null;
  charging: boolean | null;
  level: 'full' | 'uncalibrated' | 'unknown';
  percent: null;
  calibration: 'rx-display-confirmed-tx2' | 'raw-only' | 'none';
}
export interface DjiBatteryRx {
  level: 'unknown' | 'uncalibrated';
  rawGauge: number | null;
  calibration: 'raw-only' | 'none';
  percent: null;
}
export interface DjiBatteryStatus {
  status: 'ok' | 'unavailable';
  reason?: 'not-windows' | 'receiver-unavailable' | 'winusb-not-configured' |
    'winusb-device-interface-unavailable' | 'usb-read-incomplete' | 'no-valid-status-frame' |
    'read-error' | 'script-unavailable' | 'script-timeout' | 'invalid-output';
  source?: 'dji-mic3-rx-winusb';
  observedAt?: string;
  validFrames?: number;
  tx: DjiBatteryTx[];
  rx: DjiBatteryRx;
  audioHealthy?: boolean;
}
const unknown = (reason: DjiBatteryStatus['reason']): DjiBatteryStatus => ({
  status: 'unavailable', reason, tx: [], rx: { level: 'unknown', rawGauge: null, calibration: 'none', percent: null },
});
export function parseDjiBatteryResult(value: unknown): DjiBatteryStatus {
  if (!value || typeof value !== 'object') return unknown('invalid-output');
  const result = value as Record<string, unknown>;
  const reason = result.reason;
  if (result.status === 'unavailable')
    return unknown((typeof reason === 'string' && [
      'not-windows','receiver-unavailable','winusb-not-configured','winusb-device-interface-unavailable',
      'usb-read-incomplete','no-valid-status-frame','read-error','script-unavailable','script-timeout','invalid-output',
    ].includes(reason)) ? reason as DjiBatteryStatus['reason'] : 'read-error');
  if (result.status !== 'ok' || result.source !== 'dji-mic3-rx-winusb'
    || typeof result.observedAt !== 'string' || !Number.isFinite(Date.parse(result.observedAt))
    || Math.abs(Date.now()-Date.parse(result.observedAt)) > 60_000
    || !Array.isArray(result.tx) || result.tx.length !== 2) return unknown('invalid-output');
  const entries: DjiBatteryTx[] = [];
  for (let index = 0; index < 2; index++) {
    const raw = result.tx.find((entry: unknown) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).slot === index+1);
    if (!raw || typeof raw !== 'object') return unknown('invalid-output');
    const source = raw as Record<string, unknown>;
    if (typeof source.connected !== 'boolean') return unknown('invalid-output');
    const connected = source.connected;
    const gauge = connected && Number.isInteger(source.rawGauge) && Number(source.rawGauge) >= 1 && Number(source.rawGauge) <= 7
      ? Number(source.rawGauge) : null;
    const charging = typeof source.charging === 'boolean' && connected ? source.charging : null;
    entries.push({
      slot: (index + 1) as 1 | 2, connected,
      rawGauge: gauge, charging, percent: null,
      // TX2 gauge 1 = 'full' was verified against the owner's own RX.
      // We do not extrapolate that calibration to TX1, other gauge values, or percentages.
      level: connected && index === 1 && gauge === 1 ? 'full'
        : connected && gauge !== null ? 'uncalibrated' : 'unknown',
      calibration: connected && index === 1 && gauge === 1
        ? 'rx-display-confirmed-tx2' : connected && gauge !== null ? 'raw-only' : 'none',
    });
  }
  const rxInput = result.rx && typeof result.rx === 'object' ? result.rx as Record<string,unknown> : {};
  const rxGauge = Number.isInteger(rxInput.rawGauge) && Number(rxInput.rawGauge) >= 1 && Number(rxInput.rawGauge) <= 7
    ? Number(rxInput.rawGauge) : null;
  const rx: DjiBatteryRx = {
    level: rxGauge === null ? 'unknown' : 'uncalibrated',
    rawGauge: rxGauge, calibration: rxGauge === null ? 'none' : 'raw-only',
    percent: null,
  };
  return {
    status: 'ok', source: 'dji-mic3-rx-winusb', observedAt: result.observedAt,
    validFrames: Number.isInteger(result.validFrames) && Number(result.validFrames) > 0
      ? Math.min(100_000, Number(result.validFrames)) : undefined,
    audioHealthy: result.audioHealthy === true, tx: entries,
    rx,
  };
}
function packagedScriptPath() {
  const candidates = [
    ...((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
      ? [path.join((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath!, 'dji-mic3', 'Read-Battery.ps1')]
      : []),
    path.join(process.cwd(), 'resources', 'dji-mic3', 'Read-Battery.ps1'),
  ];
  return candidates.find(candidate => existsSync(candidate));
}
/** A 25-second cache prevents repeated USB reconfiguration under simultaneous requests. */
export class DjiMic3BatteryReader {
  private cache: DjiBatteryStatus | undefined;
  private lastCheck = 0;
  private inflight: Promise<DjiBatteryStatus> | undefined;
  constructor(
    private readonly execute: () => Promise<string> = async () => {
      const script = packagedScriptPath();
      if (!script) throw Object.assign(new Error('Battery reader script missing.'), { code: 'SCRIPT_MISSING' });
      const { stdout } = await executeFile('powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        { timeout: 9_000, windowsHide: true, maxBuffer: 65_536 });
      return stdout;
    },
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly now: () => number = Date.now,
  ) {}
  read(): Promise<DjiBatteryStatus> {
    if (this.platform !== 'win32') return Promise.resolve(unknown('not-windows'));
    if (this.inflight) return this.inflight;
    if (this.cache && this.now() - this.lastCheck < TTL_MS) return Promise.resolve(this.cache);
    const job = (async () => {
      let next: DjiBatteryStatus;
      try { next = parseDjiBatteryResult(JSON.parse(await this.execute())); }
      catch (error) {
        const code = (error as { code?: string; killed?: boolean }).code;
        next = unknown(code === 'SCRIPT_MISSING' ? 'script-unavailable'
          : (error as { killed?: boolean }).killed === true ? 'script-timeout' : 'read-error');
      }
      this.cache = next; this.lastCheck = this.now(); return next;
    })();
    this.inflight = job;
    void job.finally(() => { if (this.inflight === job) this.inflight = undefined; });
    return job;
  }
}
