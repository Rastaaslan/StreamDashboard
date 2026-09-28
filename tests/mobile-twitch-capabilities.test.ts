import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../apps/mobile/mobile.js', import.meta.url), 'utf8');
// Execute the actual renderer function with DOM controls and incoming snapshots.
const apply = source.slice(source.indexOf('function applyTwitchActionCapabilities()'), source.indexOf('async function loadModerationCapabilities()'));

describe('mobile Twitch clip buttons', () => {
  it.each([
    { label: 'Twitch offline while OBS streams', twitchLive: false, obsStreaming: true, scope: true, connected: true, online: true, disabled: true },
    { label: 'Twitch live without OBS streaming', twitchLive: true, obsStreaming: false, scope: true, connected: true, online: true, disabled: false },
    { label: 'missing clips scope', twitchLive: true, obsStreaming: true, scope: false, connected: true, online: true, disabled: true },
    { label: 'unknown clips scope', twitchLive: true, obsStreaming: true, scope: undefined, connected: true, online: true, disabled: true },
    { label: 'Twitch disconnected', twitchLive: true, obsStreaming: true, scope: true, connected: false, online: true, disabled: true },
    { label: 'PC disconnected', twitchLive: true, obsStreaming: true, scope: true, connected: true, online: false, disabled: true },
    { label: 'unknown Twitch live state', twitchLive: undefined, obsStreaming: true, scope: true, connected: true, online: true, disabled: true },
  ])('$label', ({ twitchLive, obsStreaming, scope, connected, online, disabled }) => {
    const controls = new Map<string, { disabled: boolean; title: string; querySelector: () => { disabled: boolean } }>();
    const $ = (id: string) => {
      if (!controls.has(id)) controls.set(id, { disabled: false, title: '', querySelector: () => ({ disabled: false }) });
      return controls.get(id)!;
    };
    const context = {
      $, state: { twitch: { connected }, obs: { streaming: obsStreaming }, controlHub: { live: { isLive: twitchLive } } },
      moderationCapabilities: { createClip: scope }, companionMode: online ? 'online' : 'offline', CompanionMode: { ONLINE_PC: 'online' },
      twitchCapability: () => true, updatePlanningProviderReadiness: () => undefined,
    };
    runInNewContext(`${apply}\napplyTwitchActionCapabilities();`, context);
    for (const id of ['live-clip', 'create-clip']) expect($(id).disabled).toBe(disabled);
    // A subsequent authoritative snapshot must update both existing DOM buttons.
    context.state.controlHub.live.isLive = !twitchLive;
    runInNewContext('applyTwitchActionCapabilities();', context);
    for (const id of ['live-clip', 'create-clip']) expect($(id).disabled).toBe(!(connected && online && scope === true && !twitchLive));
  });
});
