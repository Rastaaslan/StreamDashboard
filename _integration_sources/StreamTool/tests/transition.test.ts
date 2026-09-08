import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { waitForTransitionEvent } from '../src/obs/obs-client.js';
import { SequenceEngine } from '../src/sequences/engine.js';
import type { ObsGateway, Profile } from '../src/types.js';

const profile: Profile = {
  id: 'test', name: 'Test', theme: 'campfire',
  modes: {
    intro: { text: 'INTRO', durationSeconds: 300, timerVisible: true },
    pause: { text: 'PAUSE', durationSeconds: 600, timerVisible: true },
    end: { text: 'END', durationSeconds: 90, timerVisible: false },
  },
  scenes: { intro: 'INTRO', pause: 'PAUSE', end: 'FIN', afterIntro: 'LIVE' },
  options: { autoStartStreaming: false, autoSwitchAfterIntro: true, autoReturnAfterPause: true },
};

class ControlledObs implements ObsGateway {
  connected = true; currentScene: string | null = 'LIVE'; streaming = true;
  transitionRequests: Array<{ scene: string; finish: () => void }> = [];
  async setScene(name: string) { this.currentScene = name; }
  setSceneAndWait(name: string) {
    this.currentScene = name;
    return new Promise<void>(resolve => this.transitionRequests.push({ scene: name, finish: resolve }));
  }
  async getCurrentScene() { return this.currentScene!; }
  async startStreaming() { this.streaming = true; }
  async stopStreaming() { this.streaming = false; }
  finishTransition() { this.transitionRequests.shift()?.finish(); }
}

describe('OBS transition synchronization', () => {
  it('keeps idle visible state until the Intro transition has really ended', async () => {
    const obs = new ControlledObs();
    const engine = new SequenceEngine(profile, obs);
    const start = engine.start('intro');
    await vi.waitFor(() => expect(obs.transitionRequests).toHaveLength(1));
    expect(engine.state()).toMatchObject({ mode: 'idle', running: false });
    obs.finishTransition();
    await start;
    expect(engine.state()).toMatchObject({ mode: 'intro', remaining: 300, running: true });
  });

  it('keeps Intro displayed and neutralizes its expiration until Pause is visible', async () => {
    const obs = new ControlledObs();
    const engine = new SequenceEngine(profile, obs);
    const intro = engine.start('intro');
    await vi.waitFor(() => expect(obs.transitionRequests).toHaveLength(1));
    obs.finishTransition();
    await intro;

    const pause = engine.start('pause');
    await vi.waitFor(() => expect(obs.transitionRequests).toHaveLength(1));
    expect(engine.state()).toMatchObject({ mode: 'intro', timerVisible: true });
    obs.finishTransition();
    await pause;
    expect(engine.state()).toMatchObject({ mode: 'pause', remaining: 600, timerVisible: true });
  });

  it('coalesces a double click during a transition into one scene request and timer', async () => {
    const obs = new ControlledObs();
    const engine = new SequenceEngine(profile, obs);
    const first = engine.start('pause');
    const second = engine.start('pause');
    await vi.waitFor(() => expect(obs.transitionRequests).toHaveLength(1));
    obs.finishTransition();
    await Promise.all([first, second]);
    expect(obs.transitionRequests).toHaveLength(0);
    expect(engine.state()).toMatchObject({ mode: 'pause', duration: 600, sequence: 1 });
  });

  it('uses SceneTransitionEnded normally and a bounded timeout for Cut/missing events', async () => {
    vi.useFakeTimers();
    const events = new EventEmitter();
    const normal = waitForTransitionEvent(events, 5_000);
    events.emit('SceneTransitionEnded');
    await expect(normal).resolves.toBe('ended');

    const fallback = waitForTransitionEvent(events, 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(fallback).resolves.toBe('timeout');
    vi.useRealTimers();
  });

  it('unblocks immediately if OBS disconnects while transitioning', async () => {
    const events = new EventEmitter();
    const wait = waitForTransitionEvent(events, 5_000);
    events.emit('ConnectionClosed');
    await expect(wait).resolves.toBe('disconnected');
  });

  it('removes OBS listeners when a pending scene request is cancelled', async () => {
    const events = new EventEmitter();
    const controller = new AbortController();
    const wait = waitForTransitionEvent(events, 5_000, controller.signal);
    expect(events.listenerCount('SceneTransitionEnded')).toBe(1);
    controller.abort();
    await expect(wait).resolves.toBe('cancelled');
    expect(events.listenerCount('SceneTransitionEnded')).toBe(0);
    expect(events.listenerCount('ConnectionClosed')).toBe(0);
  });
});
