import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const executeFile = promisify(execFile);
const mediaCommands = { 'play-pause': 14, next: 11, previous: 12, play: 46, pause: 47 } as const;
export type SpotifyControlAction = keyof typeof mediaCommands;
export interface SpotifyStatus { available: boolean; supported: boolean; name: string; controller: 'windows-local'; limitation: string; }
export interface SpotifyCommandReceipt { status: 'dispatched'; message: string; action: SpotifyControlAction; }
/** Spotify window control only; no Spotify API, token, or content crosses the network. */
export class SpotifyLocalController {
  private running = Promise.resolve();
  constructor(
    private readonly execute: (source: string) => Promise<string> = async source => {
      if (process.platform !== 'win32') throw new Error('Contrôle multimédia disponible uniquement sous Windows.');
      const encoded = Buffer.from(source, 'utf16le').toString('base64');
      const result = await executeFile('powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        { timeout: 4_000, windowsHide: true, maxBuffer: 8192 });
      return result.stdout.trim();
    },
  ) {}
  async status(): Promise<SpotifyStatus> {
    if (process.platform !== 'win32') return { available: false, supported: false, name: 'Spotify', controller: 'windows-local', limitation: 'Contrôle local Windows uniquement.' };
    const script = [
      '$ErrorActionPreference="Stop"',
      '$p=Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1',
      '$state=@{available=[bool]$p;supported=$true;name="Spotify";controller="windows-local"}',
      '$state | ConvertTo-Json -Compress',
    ].join(';');
    try {
      const raw = await this.execute(script);
      const value = JSON.parse(raw) as { available?: boolean };
      return { available: value.available === true, supported: true, name: 'Spotify', controller: 'windows-local',
        limitation: 'Commandes envoyées à la fenêtre Spotify. La lecture réelle doit être vérifiée dans Spotify.' };
    } catch {
      return { available: false, supported: true, name: 'Spotify', controller: 'windows-local',
        limitation: 'Spotify inaccessible ou interrogation Windows indisponible.' };
    }
  }
  control(action: SpotifyControlAction): Promise<SpotifyCommandReceipt> {
    if (!Object.prototype.hasOwnProperty.call(mediaCommands, action))
      return Promise.reject(new Error('Commande Spotify inconnue.'));
    const run = async (): Promise<SpotifyCommandReceipt> => {
      const status = await this.status();
      if (!status.available) throw new Error('Ouvrez Spotify sur le PC qui exécute la commande.');
      const command = mediaCommands[action];
      // SendMessageTimeout avoids a hung window blocking the remote.
      // A dispatch receipt is deliberately not presented as confirmed playback.
      const script = [
        '$ErrorActionPreference="Stop"',
        '$p=Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1',
        'if(!$p){throw "Spotify fermé"}',
        'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class SDSpotifyMedia { [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeoutMs, out IntPtr result); }\'',
        '$answer=[IntPtr]::Zero',
        '$sent=[SDSpotifyMedia]::SendMessageTimeout($p.MainWindowHandle, 0x319, $p.MainWindowHandle, [IntPtr](' + command + ' -shl 16), 2, 600, [ref]$answer)',
        'if($sent -eq [IntPtr]::Zero){throw "Spotify n’a pas accepté la commande multimédia"}',
        '"dispatched"',
      ].join(';');
      const receipt = await this.execute(script);
      if (!receipt.includes('dispatched')) throw new Error('Commande Spotify non confirmée par Windows.');
      return { status: 'dispatched', action, message: 'Commande envoyée à Spotify sur ce PC. Vérifiez le lecteur pour confirmer son effet.' };
    };
    const queued = this.running.catch(() => undefined).then(run);
    this.running = queued.then(() => undefined, () => undefined);
    return queued;
  }
}
