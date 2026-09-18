import { access } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { ActionCommand, AudioOutput, CommandAcknowledgement, Sound, SoundboardSnapshot } from '../../../packages/contracts/src/index.js';
import { ActionCore } from '../../../packages/core/src/actions.js';

export interface PlaybackSession { finished: Promise<void> }
export interface SoundboardRuntimeEvent {
  type: 'playback.started' | 'playback.finished' | 'playback.stopped' | 'playback.failed';
  correlationId?: string;
  payload: Record<string, unknown>;
}

export interface AudioPlayback {
  outputs(): Promise<AudioOutput[]>;
  play(input: { file: string; volume: number; outputId: string }): Promise<PlaybackSession>;
  stop(): Promise<void>;
  readonly available: boolean;
  readonly supportedFormats: readonly string[];
  readonly supportsVolume: boolean;
  readonly supportsStop: boolean;
  readonly supportsExplicitOutputSelection: boolean;
}

export class SystemAudioPlayback implements AudioPlayback {
  private child?: ChildProcess;
  readonly available = ['win32', 'linux', 'darwin'].includes(process.platform);
  readonly supportsExplicitOutputSelection = false;
  readonly supportsStop = true;
  readonly supportsVolume = process.platform !== 'win32';
  readonly supportedFormats = process.platform === 'win32'
    ? ['wav']
    : process.platform === 'darwin'
      ? ['wav', 'mp3', 'm4a', 'aac', 'aiff']
      : ['wav', 'mp3', 'ogg', 'flac', 'm4a'];

  async outputs(): Promise<AudioOutput[]> {
    return [{ id: 'system-default', name: 'Sortie système par défaut', isDefault: true, selectable: true }];
  }

  async play(input: { file: string; volume: number; outputId: string }): Promise<PlaybackSession> {
    if (!this.available) throw runtimeError('AUDIO_BACKEND_UNAVAILABLE', 'Aucun moteur audio compatible avec ce système.', false);
    if (input.outputId !== 'system-default') throw runtimeError('AUDIO_OUTPUT_UNAVAILABLE', 'La sortie audio sélectionnée n’est pas routable par ce moteur.', true);
    if (!this.supportsVolume && Math.abs(input.volume - 1) > 0.0001) throw runtimeError('AUDIO_VOLUME_UNSUPPORTED', 'Ce moteur audio ne permet pas de régler le volume.', false);
    await this.stop();

    const spec = process.platform === 'win32'
      ? { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', "$p=$args[0];$s=New-Object System.Media.SoundPlayer $p;$s.PlaySync()", input.file] }
      : process.platform === 'darwin'
        ? { command: 'afplay', args: ['-v', String(input.volume), input.file] }
        : { command: 'ffplay', args: ['-nodisp', '-autoexit', '-loglevel', 'error', '-volume', String(Math.round(input.volume * 100)), input.file] };

    const child = spawn(spec.command, spec.args, { stdio: 'ignore', windowsHide: true });
    this.child = child;

    const finished = new Promise<void>((resolveFinished, rejectFinished) => {
      child.once('exit', (code, signal) => {
        if (this.child === child) this.child = undefined;
        if (signal || code === 0) resolveFinished();
        else rejectFinished(runtimeError('AUDIO_PLAYBACK_FAILED', `Le lecteur audio s’est arrêté avec le code ${code}.`, true));
      });
      child.once('error', error => {
        if (this.child === child) this.child = undefined;
        rejectFinished(runtimeError('AUDIO_PLAYBACK_FAILED', error.message, true));
      });
    });

    await new Promise<void>((resolveStarted, rejectStarted) => {
      child.once('spawn', resolveStarted);
      child.once('error', error => rejectStarted(runtimeError('AUDIO_PLAYBACK_FAILED', error.message, true)));
    });
    return { finished };
  }

  async stop() {
    const child = this.child;
    this.child = undefined;
    if (child && !child.killed) child.kill();
  }
}

export class SoundboardRuntime {
  private readonly actions = new ActionCore();
  private readonly cooldowns = new Map<string, number>();
  private currentPlayback: SoundboardSnapshot['currentPlayback'] = null;
  private lastError: SoundboardSnapshot['error'] = null;

  constructor(
    private sounds: Sound[],
    private readonly audio: AudioPlayback = new SystemAudioPlayback(),
    private readonly now = () => Date.now(),
    private readonly publish: (event: SoundboardRuntimeEvent) => void = () => undefined,
  ) {
    this.sounds = sounds.map(validateSound);
  }

  catalog() { return this.sounds.map(sound => ({ ...sound })); }
  replace(sounds: Sound[]) { this.sounds = sounds.map(validateSound); }

  async snapshot(): Promise<SoundboardSnapshot> {
    const outputs = await this.audio.outputs().catch(() => []);
    const publicSounds = await Promise.all(this.sounds.map(async ({ source, ...sound }) => ({ ...sound, sourceAvailable: await access(resolve(source)).then(() => true, () => false) })));
    return {
      sounds: publicSounds,
      outputs,
      currentPlayback: this.currentPlayback,
      available: this.audio.available,
      supportedFormats: [...this.audio.supportedFormats],
      supportsVolume: this.audio.supportsVolume,
      supportsStop: this.audio.supportsStop,
      supportsExplicitOutputSelection: this.audio.supportsExplicitOutputSelection,
      error: this.lastError,
    };
  }

  play(command: ActionCommand<{ soundId: string; volume?: number }>): Promise<CommandAcknowledgement> {
    return this.actions.execute(command, async correlated => {
      const sound = this.sounds.find(value => value.id === correlated.payload.soundId);
      if (!sound) throw runtimeError('SOUND_NOT_FOUND', 'Son introuvable.', false);
      if (!sound.enabled) throw runtimeError('SOUND_DISABLED', 'Ce son est désactivé.', false);
      const file = resolve(sound.source);
      const extension = extname(file).toLowerCase().replace(/^\./, '');
      if (!this.audio.supportedFormats.includes(extension)) throw runtimeError('SOUND_FORMAT_UNSUPPORTED', `Format audio .${extension || '?'} non supporté par ce moteur.`, false);
      try { await access(file); } catch { throw runtimeError('SOUND_FILE_MISSING', 'Le fichier audio est introuvable sur le PC.', false); }
      const outputs = await this.audio.outputs();
      if (!outputs.some(output => output.id === sound.outputId && output.selectable)) throw runtimeError('AUDIO_OUTPUT_UNAVAILABLE', 'La sortie audio configurée est absente.', true);
      const remaining = (this.cooldowns.get(sound.id) ?? 0) - this.now();
      if (remaining > 0) throw runtimeError('SOUND_COOLDOWN_ACTIVE', `Cooldown actif (${Math.ceil(remaining / 1_000)} s).`, true);
      const volume = correlated.payload.volume ?? sound.volume;
      if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw runtimeError('SOUND_VOLUME_INVALID', 'Volume invalide.', false);
      if (!this.audio.supportsVolume && Math.abs(volume - 1) > 0.0001) throw runtimeError('AUDIO_VOLUME_UNSUPPORTED', 'Le backend audio actif ne permet pas de régler le volume.', false);

      if (this.currentPlayback) await this.stop();
      this.lastError = null;
      const session = await this.audio.play({ file, volume, outputId: sound.outputId });
      const playback = { soundId: sound.id, commandId: correlated.commandId, startedAt: new Date(this.now()).toISOString() };
      this.currentPlayback = playback;
      this.cooldowns.set(sound.id, this.now() + sound.cooldownMs);
      this.publish({ type: 'playback.started', correlationId: correlated.correlationId, payload: playback });

      void session.finished.then(() => {
        if (this.currentPlayback?.commandId !== correlated.commandId) return;
        this.currentPlayback = null;
        this.publish({ type: 'playback.finished', correlationId: correlated.correlationId, payload: { ...playback, finishedAt: new Date(this.now()).toISOString() } });
      }).catch(error => {
        if (this.currentPlayback?.commandId !== correlated.commandId) return;
        this.currentPlayback = null;
        this.lastError = structured(error);
        this.publish({ type: 'playback.failed', correlationId: correlated.correlationId, payload: { ...playback, error: this.lastError } });
      });
    });
  }

  async stop() {
    const playback = this.currentPlayback;
    this.currentPlayback = null;
    await this.audio.stop();
    if (playback) this.publish({ type: 'playback.stopped', payload: { ...playback, stoppedAt: new Date(this.now()).toISOString() } });
  }
}

export function validateSound(value: Sound): Sound {
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(value.id)) throw new Error('Sound id invalide.');
  if (!value.name.trim() || value.name.length > 100 || !value.category.trim() || value.category.length > 80) throw new Error('Nom ou catégorie invalide.');
  if (!value.source.trim() || value.source.length > 1_000 || !value.outputId.trim() || value.outputId.length > 200) throw new Error('Source ou sortie invalide.');
  if (!Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1 || !Number.isInteger(value.cooldownMs) || value.cooldownMs < 0 || value.cooldownMs > 3_600_000) throw new Error('Volume ou cooldown invalide.');
  return { ...value, name: value.name.trim(), category: value.category.trim(), source: value.source.trim() };
}

function runtimeError(code: string, message: string, retryable: boolean) {
  const error = new Error(message);
  error.name = code;
  Object.assign(error, { retryable });
  return error;
}
function structured(error: unknown) {
  const value = error instanceof Error ? error : new Error(String(error));
  return { code: value.name === 'Error' ? 'AUDIO_PLAYBACK_FAILED' : value.name, message: value.message, retryable: Boolean((value as Error & { retryable?: boolean }).retryable), details: null };
}
