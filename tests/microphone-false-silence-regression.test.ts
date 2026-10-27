import { describe, expect, it } from 'vitest';
import { MicHealthWatch } from '../integrations/obs/src/mic-health.js';

const context = { connected: true, streaming: true, exists: true, muted: false };
function frames(watch: MicHealthWatch, start: number, end: number,
  sample: (ms: number) => number, every = 100) {
  for (let ms = start; ms <= end; ms += every) {
    watch.observe([{ inputName: 'micro', inputLevelsMul: [[sample(ms), 0]] }], ms);
  }
}

describe('OBS microphone false-positive regression', () => {
  it('does not report a soft voice below the old -35dB gate as silence', () => {
    const watch = new MicHealthWatch();
    watch.updateStream(true, 0);
    frames(watch, 0, 240_000, ms => ms % 700 < 250 ? 0.003 : 0.0002);
    const result = watch.state('micro', context, 240_100);
    expect(result.state).toBe('healthy');
    expect(result.warning).toBeNull();
    expect(result.levelPercent).toBeGreaterThan(0);
    expect(result.batteryPercent).toBeNull();
  });

  it('captures short speech bursts that a 750ms sampling interval would miss', () => {
    const watch = new MicHealthWatch();
    watch.updateStream(true, 0);
    frames(watch, 0, 180_000, ms => ms % 700 === 0 ? 0.045 : 0);
    const result = watch.state('micro', context, 180_050);
    expect(result.state).not.toBe('quiet');
    expect(result.warning).toBeNull();
  });

  it('does not arm the alarm from a source that never demonstrated audio activity', () => {
    const watch = new MicHealthWatch();
    watch.updateStream(true, 0);
    frames(watch, 0, 420_000, () => 0, 500);
    expect(watch.state('micro', context, 420_100)).toMatchObject({
      state: 'monitoring', warning: null,
    });
  });

  it('never warns about an OBS digital flatline, even after 120 seconds', () => {
    const watch = new MicHealthWatch();
    watch.updateStream(true, 0);
    frames(watch, 0, 5_000, () => 0.06);
    frames(watch, 5_100, 125_600, () => 0, 500);
    const result = watch.state('micro', context, 125_650);
    expect(result.state).toBe('monitoring');
    expect(result.warning).toBeNull();
    expect(result.batteryPercent).toBeNull();
  });

  it('immediately shows speech activity after an extended flatline', () => {
    const watch = new MicHealthWatch();
    watch.updateStream(true, 0);
    frames(watch, 0, 5_000, () => 0.06);
    frames(watch, 5_100, 125_600, () => 0, 500);
    expect(watch.state('micro', context, 125_650).state).toBe('monitoring');
    watch.observe([{ inputName: 'micro', inputLevelsMul: [[0.00021, 0]] }], 125_700);
    expect(watch.state('micro', context, 125_750)).toMatchObject({
      state: 'healthy', warning: null, secondsSilent: 0,
    });
  });

  it('does not show a silence alert when OBS telemetry is stale or malformed', () => {
    const watch = new MicHealthWatch();
    watch.updateStream(true, 0);
    frames(watch, 0, 5_000, () => 0.06);
    watch.observe([{ inputName: 'micro', inputLevelsMul: [[0]] }], 5_050);
    expect(watch.state('micro', context, 30_000).state).toBe('unavailable');
    expect(watch.observe([{ inputName: 'micro', inputLevelsMul: [[NaN, Infinity]] }], 30_010)).toBe(false);
    expect(watch.state('micro', context, 30_020).state).toBe('unavailable');
  });

  it('never carries watchdog evidence from a previous live into another', () => {
    const watch = new MicHealthWatch();
    watch.updateStream(true, 0);
    frames(watch, 0, 5_000, () => 0.06);
    watch.updateStream(false, 10_000);
    watch.updateStream(true, 20_000);
    frames(watch, 20_000, 210_000, () => 0, 500);
    expect(watch.state('micro', context, 210_050)).toMatchObject({
      state: 'monitoring', warning: null,
    });
  });

  it('does not mistake a noisy neighboring OBS input for the configured microphone', () => {
    const watch = new MicHealthWatch();
    watch.updateStream(true, 0);
    for (let ms = 0; ms <= 150_000; ms += 500) {
      watch.observe([
        { inputName: 'music', inputLevelsMul: [[0.6]] },
        { inputName: 'micro', inputLevelsMul: [[0]] },
      ], ms);
    }
    expect(watch.state('micro', context, 150_100).state).toBe('monitoring');
    expect(watch.state('music', context, 150_100).state).toBe('healthy');
  });

  it('does not call intentionally muted OBS inputs a silence failure', () => {
    const watch = new MicHealthWatch();
    watch.updateStream(true, 0);
    frames(watch, 0, 5_000, () => 0.06);
    frames(watch, 5_100, 125_600, () => 0, 500);
    expect(watch.state('micro', { ...context, muted: true }, 125_650).state).toBe('muted');
  });
});
