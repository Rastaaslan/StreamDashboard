import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';

const SECRET_PATTERN = /["']?(access[_-]?token|refresh[_-]?token|device[_-]?code|obsPassword)["']?\s*[:=]\s*["']?[^"'\s,}]+["']?/gi;
const AUTHORIZATION_PATTERN = /authorization\s*[:=]\s*(?:bearer|oauth)?\s*[^\s,}]+/gi;
export class DesktopLogger {
  readonly file: string;
  constructor(logDir: string) { this.file = path.join(logDir, 'streamdashboard.log'); }
  private async line(level: string, values: unknown[]) {
    await mkdir(path.dirname(this.file), { recursive: true });
    try { if ((await stat(this.file)).size > 2_000_000) await rename(this.file, `${this.file}.1`); } catch { /* first log */ }
    const text = values.map(value => value instanceof Error ? value.stack ?? value.message : typeof value === 'string' ? value : JSON.stringify(value)).join(' ').replace(SECRET_PATTERN, '$1=[REDACTED]').replace(AUTHORIZATION_PATTERN, 'authorization=[REDACTED]');
    await appendFile(this.file, `${new Date().toISOString()} ${level} ${text}\n`, 'utf8');
  }
  info(...values: unknown[]) { return this.line('INFO', values); }
  warn(...values: unknown[]) { return this.line('WARN', values); }
  error(...values: unknown[]) { return this.line('ERROR', values); }
  debug(...values: unknown[]) { return !process.env.NODE_ENV || process.env.NODE_ENV === 'development' ? this.line('DEBUG', values) : Promise.resolve(); }
}
