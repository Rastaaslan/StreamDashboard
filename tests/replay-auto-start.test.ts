import { describe, expect, it } from 'vitest';
import { replayAutoStartDecision } from '../apps/server/src/replay-auto-start.js';

const now = Date.parse('2026-10-20T20:00:00Z');
function fixture() {
  return {
    obs: { connected: true, streaming: false, streamingKnown: true, connectionGeneration: 3 },
    outputs: { twitch: { kind: 'main', name: '' }, youtube: { kind: 'aitum-suite', name: 'YouTube Output' } },
    observations: { youtube: { kind: 'aitum-suite', name: 'YouTube Output', active: true as boolean | null, observedAt: new Date(now).toISOString() } },
    observationGeneration: 3, enabled: true, attempted: false, now,
  };
}

describe('replay automatic preparation from confirmed OBS outputs', () => {
  it('prepares the buffer for a YouTube-only Aitum live with the main output stopped', () => {
    expect(replayAutoStartDecision(fixture())).toEqual({ start: true, attempted: true });
  });
  it('also recognizes a configured named native output and the main OBS output', () => {
    const input = fixture();
    input.outputs.youtube.kind = 'output'; input.observations.youtube.kind = 'output';
    expect(replayAutoStartDecision(input).start).toBe(true);
    input.observations.youtube.active = null; input.obs.streaming = true;
    expect(replayAutoStartDecision(input).start).toBe(true);
  });
  it('does not prepare from an old connection, stale timestamp or different output identity', () => {
    for (const change of [
      (input: ReturnType<typeof fixture>) => { input.observationGeneration = 2; },
      (input: ReturnType<typeof fixture>) => { input.observations.youtube.observedAt = new Date(now - 60_000).toISOString(); },
      (input: ReturnType<typeof fixture>) => { input.observations.youtube.observedAt = new Date(now + 60_000).toISOString(); },
      (input: ReturnType<typeof fixture>) => { input.observations.youtube.name = 'Previous Output'; },
      (input: ReturnType<typeof fixture>) => { input.observations.youtube.kind = 'output'; },
    ]) {
      const input = fixture(); change(input);
      expect(replayAutoStartDecision(input)).toEqual({ start: false, attempted: false });
      input.attempted = true;
      expect(replayAutoStartDecision(input)).toEqual({ start: false, attempted: true });
    }
  });
  it('does not restart a manually stopped buffer during the same live or a temporary disconnect', () => {
    const input = fixture(); input.attempted = true;
    expect(replayAutoStartDecision(input)).toEqual({ start: false, attempted: true });
    input.obs.connected = false;
    expect(replayAutoStartDecision(input)).toEqual({ start: false, attempted: true });
    input.obs.connected = true; input.observations.youtube.active = null;
    expect(replayAutoStartDecision(input)).toEqual({ start: false, attempted: true });
  });
  it('resets the attempt only when all local outputs are confirmed stopped, then prepares the next live', () => {
    const input = fixture(); input.attempted = true; input.observations.youtube.active = false;
    const stopped = replayAutoStartDecision(input);
    expect(stopped).toEqual({ start: false, attempted: false });
    input.attempted = stopped.attempted; input.observations.youtube.active = true;
    expect(replayAutoStartDecision(input)).toEqual({ start: true, attempted: true });
  });
  it('honors the preference and never treats an unknown main-output observation as active or stopped', () => {
    const input = fixture(); input.enabled = false;
    expect(replayAutoStartDecision(input)).toEqual({ start: false, attempted: false });
    input.enabled = true; input.obs.streaming = true; input.obs.streamingKnown = false;
    input.observations.youtube.active = false;
    expect(replayAutoStartDecision(input)).toEqual({ start: false, attempted: false });
    input.attempted = true;
    expect(replayAutoStartDecision(input)).toEqual({ start: false, attempted: true });
  });
});
