import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SoundboardRuntime, type AudioPlayback } from '../apps/server/src/soundboard-runtime.js';

let dir = ''; afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ''; });
async function fixture() { dir = await mkdtemp(path.join(os.tmpdir(), 'soundboard-')); const file = path.join(dir, 'bonk.wav'); await writeFile(file, 'RIFF'); return file; }
const command = (id = 'op-1') => ({ commandId: id, type: 'soundboard.play', origin: 'android' as const, issuedAt: new Date().toISOString(), payload: { soundId: 'bonk' } });
const sound = (source: string) => ({ id: 'bonk', name: 'Bonk', category: 'Réactions', source, favorite: true, volume: .8, cooldownMs: 1_000, enabled: true, outputId: 'default' });
function backend(play = vi.fn(async () => undefined)): AudioPlayback { return { available: true, supportsExplicitOutputSelection: false, outputs: async () => [{ id: 'default', name: 'Default', isDefault: true, selectable: true }], play, stop: vi.fn(async () => undefined) }; }

describe('SoundboardRuntime', () => {
  it('lit réellement via AudioPlayback et déduplique commandId', async () => { const file = await fixture(); const audio = backend(); const runtime = new SoundboardRuntime([sound(file)], audio); const first = await runtime.play(command()); const retry = await runtime.play(command()); expect(first.status).toBe('succeeded'); expect(retry).toEqual(first); expect(audio.play).toHaveBeenCalledTimes(1); });
  it('retourne un ACK failed pour fichier absent, output absent et playback échoué', async () => { const missing = new SoundboardRuntime([sound('/missing.wav')], backend()); expect((await missing.play(command())).errorCode).toBe('SOUND_FILE_MISSING'); const file = await fixture(); const noOutput = backend(); noOutput.outputs = async () => []; expect((await new SoundboardRuntime([sound(file)], noOutput).play(command())).errorCode).toBe('AUDIO_OUTPUT_UNAVAILABLE'); const failed = backend(vi.fn(async () => { const error = new Error('device lost'); error.name = 'AUDIO_PLAYBACK_FAILED'; throw error; })); expect((await new SoundboardRuntime([sound(file)], failed).play(command())).status).toBe('failed'); });
  it('applique le cooldown uniquement après une lecture confirmée', async () => { const file = await fixture(); let now = 1_000; const runtime = new SoundboardRuntime([sound(file)], backend(), () => now); expect((await runtime.play(command('one'))).status).toBe('succeeded'); now = 1_500; expect((await runtime.play(command('two'))).errorCode).toBe('SOUND_COOLDOWN_ACTIVE'); now = 2_001; expect((await runtime.play(command('three'))).status).toBe('succeeded'); });
});
