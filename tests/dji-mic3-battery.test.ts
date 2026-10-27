import { describe, expect, it, vi } from 'vitest';
import { DjiMic3BatteryReader, parseDjiBatteryResult } from '../apps/server/src/dji-mic3-battery.js';

const fixture = (updated: string) => ({
  status: 'ok', source: 'dji-mic3-rx-winusb', observedAt: updated,
  validFrames: 32, audioHealthy: true,
  rx: { level: 'uncalibrated', rawGauge: 1, calibration: 'raw-only', percent: null },
  tx: [
    { slot: 1, connected: false, rawGauge: null, level: 'unknown', charging: null, percent: null },
    { slot: 2, connected: true, rawGauge: 1, level: 'full', charging: false, percent: null },
  ],
});

describe('DJI Mic 3 trusted raw battery observation', () => {
  it('uses the observed RX display to label TX2 full, never invents a % or RX battery', () => {
    const state = parseDjiBatteryResult(fixture(new Date().toISOString()));
    expect(state.status).toBe('ok');
    expect(state.tx[0]).toMatchObject({ slot: 1, connected: false, rawGauge: null, level: 'unknown', percent: null });
    expect(state.tx[1]).toMatchObject({ slot: 2, connected: true, rawGauge: 1,
      level: 'full', calibration: 'rx-display-confirmed-tx2', percent: null });
    expect(state.rx).toEqual({ level: 'uncalibrated', rawGauge: 1, calibration: 'raw-only', percent: null });
  });
  it('does not invent RX levels when the vendor flags are unrecognized', () => {
    const value = fixture(new Date().toISOString());
    value.rx.rawGauge = 8;
    const status = parseDjiBatteryResult(value);
    expect(status.rx).toEqual({level:'unknown',rawGauge:null,calibration:'none',percent:null});
  });
  it('does not present uncalibrated levels or TX1 as confirmed full', () => {
    const value = fixture(new Date().toISOString());
    value.tx[0] = { slot:1, connected:true, rawGauge:1, level:'full', charging:false, percent:null };
    value.tx[1].rawGauge = 6;
    value.tx[1].level = 'full';
    const parsed = parseDjiBatteryResult(value);
    expect(parsed.tx[0]).toMatchObject({level:'uncalibrated', rawGauge:1,percent:null});
    expect(parsed.tx[1]).toMatchObject({level:'uncalibrated',rawGauge:6,percent:null});
  });
  it('rejects stale and malformed source data rather than displaying yesterday’s gauge', () => {
    expect(parseDjiBatteryResult(fixture('2020-01-01T01:02:03Z')).status).toBe('unavailable');
    expect(parseDjiBatteryResult({status:'ok',source:'evil',tx:[]}).status).toBe('unavailable');
    expect(parseDjiBatteryResult({status:'unavailable',reason:'receiver-unavailable'})).toMatchObject({status:'unavailable', reason:'receiver-unavailable'});
    const duplicated = fixture(new Date().toISOString());
    duplicated.tx[0].slot = 2;
    expect(parseDjiBatteryResult(duplicated).status).toBe('unavailable');
  });
  it('never launches USB probes on non-Windows hosts', async () => {
    const execute = vi.fn(async () => '{}');
    const reader = new DjiMic3BatteryReader(execute,'linux');
    expect((await reader.read()).reason).toBe('not-windows');
    expect(execute).not.toHaveBeenCalled();
  });
  it('caches measurements and coalesces concurrent access without USB races', async () => {
    const instant = new Date().toISOString();
    let tick = 100_000;
    const execute = vi.fn(async () => JSON.stringify(fixture(instant)));
    const reader = new DjiMic3BatteryReader(execute,'win32',() => tick);
    const [one,two] = await Promise.all([reader.read(),reader.read()]);
    expect(one).toEqual(two);
    expect(execute).toHaveBeenCalledTimes(1);
    tick+= 10_000;
    await reader.read();
    expect(execute).toHaveBeenCalledTimes(1);
    tick+= 20_000;
    await reader.read();
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
