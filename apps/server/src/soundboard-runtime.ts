import { access } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { ActionCommand, AudioOutput, CommandAcknowledgement, Sound, SoundboardSnapshot } from '../../../packages/contracts/src/index.js';
import { ActionCore } from '../../../packages/core/src/actions.js';

const SUPPORTED_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.flac', '.m4a']);

export interface AudioPlayback {
  outputs(): Promise<AudioOutput[]>;
  play(input: { file: string; volume: number; outputId: string }): Promise<void>;
  stop(): Promise<void>;
  readonly available: boolean;
  readonly supportsExplicitOutputSelection: boolean;
}

export class SystemAudioPlayback implements AudioPlayback {
  private child?: ChildProcess;
  readonly available = ['win32', 'linux', 'darwin'].includes(process.platform);
  readonly supportsExplicitOutputSelection = false;

  async outputs(): Promise<AudioOutput[]> {
    return [{ id: 'system-default', name: 'Sortie système par défaut', isDefault: true, selectable: true }];
  }

  async play(input: { file: string; volume: number; outputId: string }) {
    if (!this.available) throw runtimeError('AUDIO_BACKEND_UNAVAILABLE', 'Aucun moteur audio compatible avec ce système.', false);
    if (input.outputId !== 'system-default') throw runtimeError('AUDIO_OUTPUT_UNAVAILABLE', 'La sortie audio sélectionnée n’est pas routable par ce moteur.', true);
    await this.stop();
    const spec = process.platform === 'win32'
      ? { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', "$p=$args[0];$s=New-Object System.Media.SoundPlayer $p;$s.PlaySync()", input.file] }
      : process.platform === 'darwin'
        ? { command: 'afplay', args: ['-v', String(input.volume), input.file] }
        : { command: 'ffplay', args: ['-nodisp', '-autoexit', '-loglevel', 'error', '-volume', String(Math.round(input.volume * 100)), input.file] };
    await new Promise<void>((resolvePlay, reject) => {
      const child = spawn(spec.command, spec.args, { stdio: 'ignore', windowsHide: true });
      this.child = child;
      child.once('error', error => { if (this.child === child) this.child = undefined; reject(runtimeError('AUDIO_PLAYBACK_FAILED', error.message, true)); });
      child.once('exit', code => { if (this.child === child) this.child = undefined; code === 0 ? resolvePlay() : reject(runtimeError('AUDIO_PLAYBACK_FAILED', `Le lecteur audio s’est arrêté avec le code ${code}.`, true)); });
    });
  }

  async stop() { if (this.child && !this.child.killed) this.child.kill(); this.child = undefined; }
}

export class SoundboardRuntime {
  private readonly actions = new ActionCore();
  private readonly cooldowns = new Map<string, number>();
  private currentPlayback: SoundboardSnapshot['currentPlayback'] = null;
  private lastError: SoundboardSnapshot['error'] = null;

  constructor(private sounds: Sound[], private readonly audio: AudioPlayback = new SystemAudioPlayback(), private readonly now = () => Date.now()) {
    this.sounds = sounds.map(validateSound);
  }

  catalog() { return this.sounds.map(sound => ({ ...sound })); }
  replace(sounds: Sound[]) { this.sounds = sounds.map(validateSound); }

  async snapshot(): Promise<SoundboardSnapshot> {
    const outputs = await this.audio.outputs().catch(() => []);
    const publicSounds = await Promise.all(this.sounds.map(async ({ source, ...sound }) => ({ ...sound, sourceAvailable: await access(resolve(source)).then(() => true, () => false) })));
    return { sounds: publicSounds, outputs, currentPlayback: this.currentPlayback, available: this.audio.available, supportsExplicitOutputSelection: this.audio.supportsExplicitOutputSelection, error: this.lastError };
  }

  play(command: ActionCommand<{ soundId: string; volume?: number }>): Promise<CommandAcknowledgement> {
    return this.actions.execute(command, async correlated => {
      const sound = this.sounds.find(value => value.id === correlated.payload.soundId);
      if (!sound) throw runtimeError('SOUND_NOT_FOUND', 'Son introuvable.', false);
      if (!sound.enabled) throw runtimeError('SOUND_DISABLED', 'Ce son est désactivé.', false);
      const file = resolve(sound.source);
      if (!SUPPORTED_EXTENSIONS.has(extname(file).toLowerCase())) throw runtimeError('SOUND_FORMAT_UNSUPPORTED', 'Format audio non supporté.', false);
      try { await access(file); } catch { throw runtimeError('SOUND_FILE_MISSING', 'Le fichier audio est introuvable sur le PC.', false); }
      const outputs = await this.audio.outputs();
      if (!outputs.some(output => output.id === sound.outputId && output.selectable)) throw runtimeError('AUDIO_OUTPUT_UNAVAILABLE', 'La sortie audio configurée est absente.', true);
      const remaining = (this.cooldowns.get(sound.id) ?? 0) - this.now();
      if (remaining > 0) throw runtimeError('SOUND_COOLDOWN_ACTIVE', `Cooldown actif (${Math.ceil(remaining / 1_000)} s).`, true);
      const volume = correlated.payload.volume ?? sound.volume;
      if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw runtimeError('SOUND_VOLUME_INVALID', 'Volume invalide.', false);
      this.currentPlayback = { soundId: sound.id, commandId: correlated.commandId, startedAt: new Date(this.now()).toISOString() };
      this.lastError = null;
      try { await this.audio.play({ file, volume, outputId: sound.outputId }); this.cooldowns.set(sound.id, this.now() + sound.cooldownMs); }
      catch (error) { this.lastError = structured(error); throw error; }
      finally { this.currentPlayback = null; }
    });
  }

  async stop() { await this.audio.stop(); this.currentPlayback = null; }
}

export function validateSound(value: Sound): Sound {
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(value.id)) throw new Error('Sound id invalide.');
  if (!value.name.trim() || value.name.length > 100 || !value.category.trim() || value.category.length > 80) throw new Error('Nom ou catégorie invalide.');
  if (!value.source.trim() || value.source.length > 1_000 || !value.outputId.trim() || value.outputId.length > 200) throw new Error('Source ou sortie invalide.');
  if (!Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1 || !Number.isInteger(value.cooldownMs) || value.cooldownMs < 0 || value.cooldownMs > 3_600_000) throw new Error('Volume ou cooldown invalide.');
  return { ...value, name: value.name.trim(), category: value.category.trim(), source: value.source.trim() };
}

function runtimeError(code: string, message: string, retryable: boolean) { const error = new Error(message); error.name = code; Object.assign(error, { retryable }); return error; }
function structured(error: unknown) { const value = error instanceof Error ? error : new Error(String(error)); return { code: value.name === 'Error' ? 'AUDIO_PLAYBACK_FAILED' : value.name, message: value.message, retryable: Boolean((value as Error & { retryable?: boolean }).retryable), details: null }; }
