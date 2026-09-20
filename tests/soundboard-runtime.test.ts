import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SoundboardRuntime, type AudioPlayback, type PlaybackSession, type SoundboardRuntimeEvent } from '../apps/server/src/soundboard-runtime.js';

let dir = '';
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ''; });

async function fixture(ext = 'wav') {
  dir = await mkdtemp(path.join(os.tmpdir(), 'soundboard-'));
  const file = path.join(dir, `bonk.${ext}`);
  await writeFile(file, 'RIFF');
  return file;
}
const command = (id = 'op-1') => ({ commandId: id, type: 'soundboard.play', origin: 'android' as const, issuedAt: new Date().toISOString(), payload: { soundId: 'bonk' } });
const sound = (source: string, volume = .8) => ({ id: 'bonk', name: 'Bonk', category: 'Réactions', source, favorite: true, volume, cooldownMs: 1_000, enabled: true, outputId: 'default' });

function backend(options: Partial<AudioPlayback> = {}): AudioPlayback {
  return {
    available: true,
    supportedFormats: ['wav', 'mp3'],
    supportsVolume: true,
    supportsStop: true,
    supportsExplicitOutputSelection: false,
    outputs: async () => [{ id: 'default', name: 'Default', isDefault: true, selectable: true }],
    play: async () => ({ finished: Promise.resolve() }),
    stop: vi.fn(async () => undefined),
    ...options,
  };
}

describe('SoundboardRuntime', () => {
  it('ACK le démarrage sans attendre la fin et publie le lifecycle', async () => {
    const file = await fixture();
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const events: SoundboardRuntimeEvent[] = [];
    const audio = backend({ play: vi.fn(async (): Promise<PlaybackSession> => ({ finished })) });
    const runtime = new SoundboardRuntime([sound(file)], audio, () => 1_000, event => events.push(event));

    const ack = await runtime.play(command());
    expect(ack.status).toBe('succeeded');
    expect((await runtime.snapshot()).currentPlayback).toMatchObject({ soundId: 'bonk', commandId: 'op-1' });
    expect(events.map(event => event.type)).toEqual(['playback.started']);

    finish();
    await vi.waitFor(async () => expect((await runtime.snapshot()).currentPlayback).toBeNull());
    expect(events.map(event => event.type)).toEqual(['playback.started', 'playback.finished']);
  });

  it('déduplique commandId sans rejouer le backend', async () => {
    const file = await fixture();
    const play = vi.fn(async () => ({ finished: Promise.resolve() }));
    const audio = backend({ play });
    const runtime = new SoundboardRuntime([sound(file)], audio);
    const first = await runtime.play(command());
    const retry = await runtime.play(command());
    expect(retry).toEqual(first);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('retourne un ACK failed pour fichier absent, output absent et playback échoué au démarrage', async () => {
    const missing = new SoundboardRuntime([sound('/missing.wav')], backend());
    expect((await missing.play(command())).errorCode).toBe('SOUND_FILE_MISSING');

    const file = await fixture();
    const noOutput = backend({ outputs: async () => [] });
    expect((await new SoundboardRuntime([sound(file)], noOutput).play(command())).errorCode).toBe('AUDIO_OUTPUT_UNAVAILABLE');

    const failed = backend({ play: vi.fn(async () => { const error = new Error('device lost'); error.name = 'AUDIO_PLAYBACK_FAILED'; throw error; }) });
    expect((await new SoundboardRuntime([sound(file)], failed).play(command())).status).toBe('failed');
  });

  it('applique le cooldown dès le démarrage confirmé', async () => {
    const file = await fixture();
    let now = 1_000;
    const runtime = new SoundboardRuntime([sound(file)], backend(), () => now);
    expect((await runtime.play(command('one'))).status).toBe('succeeded');
    now = 1_500;
    expect((await runtime.play(command('two'))).errorCode).toBe('SOUND_COOLDOWN_ACTIVE');
    now = 2_001;
    expect((await runtime.play(command('three'))).status).toBe('succeeded');
  });

  it('rejette formats et volume que le backend n’annonce pas', async () => {
    const mp3 = await fixture('mp3');
    const wavOnly = backend({ supportedFormats: ['wav'] });
    expect((await new SoundboardRuntime([sound(mp3, 1)], wavOnly).play(command())).errorCode).toBe('SOUND_FORMAT_UNSUPPORTED');

    const wav = await fixture('wav');
    const noVolume = backend({ supportedFormats: ['wav'], supportsVolume: false });
    expect((await new SoundboardRuntime([sound(wav, .8)], noVolume).play(command())).errorCode).toBe('AUDIO_VOLUME_UNSUPPORTED');
  });

  it('ajuste le volume en direct quand le backend le supporte', async () => {
    const setVolume = vi.fn(async () => undefined);
    const runtime = new SoundboardRuntime([], backend({ setVolume }));
    await runtime.setVolume(.35);
    expect(setVolume).toHaveBeenCalledWith(.35);
    await expect(runtime.setVolume(2)).rejects.toMatchObject({ name: 'SOUND_VOLUME_INVALID' });
    await expect(new SoundboardRuntime([], backend({ supportsVolume: false })).setVolume(.5)).rejects.toMatchObject({ name: 'AUDIO_VOLUME_UNSUPPORTED' });
  });

  it('Stop publie playback.stopped et empêche un finished tardif', async () => {
    const file = await fixture();
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const events: SoundboardRuntimeEvent[] = [];
    const stop = vi.fn(async () => undefined);
    const runtime = new SoundboardRuntime([sound(file)], backend({ play: async () => ({ finished }), stop }), () => 1_000, event => events.push(event));
    await runtime.play(command());
    await runtime.stop();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(events.map(event => event.type)).toEqual(['playback.started', 'playback.stopped']);
    finish();
    await Promise.resolve();
    expect(events.map(event => event.type)).toEqual(['playback.started', 'playback.stopped']);
  });
});
