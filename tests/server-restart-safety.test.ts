import { describe, expect, it, vi } from 'vitest';
import { assessRestartSafety, type RestartSafetySource } from '../apps/server/src/restart-safety.js';

type NativeOutput = Awaited<ReturnType<RestartSafetySource['obs']['outputs']>>[number];
function fixture() {
  const controls = { stopped: false, pending: false, revision: 'revision-1' };
  const configuration = { outputs: { twitch: { kind: 'main', name: '' }, youtube: { kind: 'output', name: 'YouTube' } } };
  const obs = {
    state: { connected: true, streamingKnown: true, streaming: false, recording: false },
    connectionGeneration: 1,
    refresh: vi.fn(async () => {}),
    outputs: vi.fn(async (): Promise<NativeOutput[]> => [{ outputName: 'YouTube', outputActive: false, outputFlags: { OBS_OUTPUT_SERVICE: true } }]),
    streamSuiteOutputs: vi.fn(async () => ({ outputs: [{ name: 'YouTube', type: 'stream', active: false as boolean | null }] })),
  };
  const source: RestartSafetySource = { obsEnabled: true, stopped: () => controls.stopped, pending: () => controls.pending, revision: () => controls.revision, configuration: () => configuration, obs };
  return { source, obs, controls, configuration };
}

describe('server restart safety observes the actual OBS outputs', () => {
  it('requires fresh native outputs and refreshed stream/record status for every check', async () => {
    const f = fixture();
    await expect(assessRestartSafety(f.source)).resolves.toEqual({ safe: true });
    expect(f.obs.refresh).toHaveBeenCalledTimes(1);
    expect(f.obs.outputs).toHaveBeenCalledTimes(1);
    expect(f.obs.streamSuiteOutputs).not.toHaveBeenCalled();
    f.obs.refresh.mockImplementation(async () => { f.obs.state.streaming = true; });
    expect((await assessRestartSafety(f.source)).safe).toBe(false);
    expect(f.obs.refresh).toHaveBeenCalledTimes(2);
    expect(f.obs.outputs).toHaveBeenCalledTimes(2);
  });

  it.each(['streaming', 'recording'] as const)('refuses a fresh %s status despite a previously idle dashboard', async field => {
    const f = fixture();
    f.obs.refresh.mockImplementation(async () => { f.obs.state[field] = true; });
    expect((await assessRestartSafety(f.source)).safe).toBe(false);
  });

  it('refuses an unknown primary stream status', async () => {
    const f = fixture();
    f.obs.refresh.mockImplementation(async () => { f.obs.state.streamingKnown = false; });
    expect((await assessRestartSafety(f.source)).safe).toBe(false);
  });

  it.each([true, undefined])('refuses an additional native stream whose fresh active status is %s', async active => {
    const f = fixture();
    // This destination is not selected in Dashboard. GetOutputList uses the
    // OBS_OUTPUT_SERVICE key, as emitted by obs-websocket's Obs_ArrayHelper.
    f.obs.outputs.mockResolvedValue([
      { outputName: 'YouTube', outputActive: false, outputFlags: { OBS_OUTPUT_SERVICE: true } },
      { outputName: 'Unselected RTMP destination', outputActive: active, outputFlags: { OBS_OUTPUT_SERVICE: true } },
    ]);
    expect((await assessRestartSafety(f.source)).safe).toBe(false);
  });

  it('allows an idle streamer with an active non-stream replay output', async () => {
    const f = fixture();
    f.obs.outputs.mockResolvedValue([
      { outputName: 'YouTube', outputActive: false, outputFlags: { OBS_OUTPUT_SERVICE: true } },
      { outputName: 'Replay buffer', outputActive: true, outputFlags: { OBS_OUTPUT_SERVICE: false } },
    ]);
    await expect(assessRestartSafety(f.source)).resolves.toEqual({ safe: true });
  });

  it.each([
    ['missing', []],
    ['ambiguous', [{ outputName: 'YouTube', outputActive: false }, { outputName: 'YouTube', outputActive: false }]],
    ['unknown', [{ outputName: 'YouTube' }]],
    ['active', [{ outputName: 'YouTube', outputActive: true }]],
  ] as const)('refuses a configured native destination that is %s', async (_name, outputs) => {
    const f = fixture();
    f.obs.outputs.mockResolvedValue([...outputs]);
    expect((await assessRestartSafety(f.source)).safe).toBe(false);
  });

  it.each([true, null])('refuses an Aitum stream with active state %s even when native OBS is idle', async active => {
    const f = fixture();
    f.configuration.outputs.youtube.kind = 'aitum-suite';
    f.obs.streamSuiteOutputs.mockResolvedValue({ outputs: [{ name: 'YouTube', type: 'stream', active }] });
    expect((await assessRestartSafety(f.source)).safe).toBe(false);
    expect(f.obs.streamSuiteOutputs).toHaveBeenCalledExactlyOnceWith();
  });

  it('requires the configured Aitum destination and also inspects unselected streams', async () => {
    const f = fixture();
    f.configuration.outputs.youtube.kind = 'aitum-suite';
    await expect(assessRestartSafety(f.source)).resolves.toEqual({ safe: true });
    f.obs.streamSuiteOutputs.mockResolvedValue({ outputs: [{ name: 'Different destination', type: 'stream', active: false }] });
    expect((await assessRestartSafety(f.source)).safe).toBe(false);
    f.obs.streamSuiteOutputs.mockResolvedValue({ outputs: [{ name: 'YouTube', type: 'stream', active: false }, { name: 'Another destination', type: 'stream', active: true }] });
    expect((await assessRestartSafety(f.source)).safe).toBe(false);
  });

  it.each(['native', 'suite', 'refresh'] as const)('refuses when the fresh %s observation fails', async kind => {
    const f = fixture();
    f.configuration.outputs.youtube.kind = 'aitum-suite';
    const operation = kind === 'native' ? f.obs.outputs : kind === 'suite' ? f.obs.streamSuiteOutputs : f.obs.refresh;
    operation.mockRejectedValue(new Error('Disconnected during observation'));
    expect((await assessRestartSafety(f.source)).safe).toBe(false);
  });

  it.each(['configuration', 'connection generation', 'revision', 'pending command', 'shutdown', 'disconnection'] as const)('rejects a changed %s while waiting for observations', async change => {
    const f = fixture();
    let release!: () => void;
    f.obs.refresh.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const assessment = assessRestartSafety(f.source);
    expect(f.obs.refresh).toHaveBeenCalledTimes(1);
    switch (change) {
      case 'configuration': f.configuration.outputs.youtube.name = 'New destination'; break;
      case 'connection generation': f.obs.connectionGeneration++; break;
      case 'revision': f.controls.revision = 'revision-2'; break;
      case 'pending command': f.controls.pending = true; break;
      case 'shutdown': f.controls.stopped = true; break;
      case 'disconnection': f.obs.state.connected = false; break;
    }
    release();
    expect((await assessment).safe).toBe(false);
  });

  it.each(['pending', 'stopped'] as const)('does not query OBS if the runtime is already %s', async field => {
    const f = fixture(); f.controls[field] = true;
    expect((await assessRestartSafety(f.source)).safe).toBe(false);
    expect(f.obs.outputs).not.toHaveBeenCalled();
    expect(f.obs.refresh).not.toHaveBeenCalled();
  });

  it('refuses absent OBS on a stream host and allows the control-only runtime without connecting OBS', async () => {
    const f = fixture(); f.obs.state.connected = false;
    expect((await assessRestartSafety(f.source)).safe).toBe(false);
    expect(f.obs.outputs).not.toHaveBeenCalled();
    expect(f.obs.refresh).not.toHaveBeenCalled();
    f.source.obsEnabled = false;
    await expect(assessRestartSafety(f.source)).resolves.toEqual({ safe: true });
    expect(f.obs.outputs).not.toHaveBeenCalled();
    expect(f.obs.refresh).not.toHaveBeenCalled();
    f.controls.pending = true;
    expect((await assessRestartSafety(f.source)).safe).toBe(false);
  });
});
