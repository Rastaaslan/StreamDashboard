export function devFixtureName(locationLike) {
  if (!['localhost', '127.0.0.1', 'appassets.androidplatform.net'].includes(locationLike.hostname)) return null;
  return new URLSearchParams(locationLike.search).get('fixture');
}

export function createMobileFixture(name = 'live') {
  const live = name !== 'offline';
  const now = new Date();
  const planning = [{ id: 'fixture-plan', title: 'Minecraft Moddé', startAtUtc: new Date(now.getTime() + 3_600_000).toISOString(), endAtUtc: new Date(now.getTime() + 14_400_000).toISOString(), category: 'live', desiredPublication: { twitch: true } }];
  const messages = [{ id: 'm1', text: 'mdrrrr derrière toi', receivedAt: now.toISOString(), chatter: { id: 'u1', displayName: 'Mimi', color: '#d58a43', badges: [{ setId: 'mod' }] } }, { id: 'm2', text: 'gg !', receivedAt: now.toISOString(), chatter: { id: 'u2', displayName: 'Fred', color: '#8067f4', badges: [{ setId: 'vip' }] } }];
  return {
    state: { at: now.toISOString(), mode: live ? 'live' : 'idle', timer: { running: false, remaining: 300, deadline: null }, nextLive: planning[0], planning, checklist: [], obs: { connected: true, streaming: live, scene: 'Gameplay', inputs: { Mic: { muted: false, volumeDb: -8 }, Game: { muted: false, volumeDb: -14 }, Discord: { muted: false, volumeDb: -18 } }, activeAudioInputs: ['Mic', 'Game', 'Discord'], mediaInputs: [] }, settings: { confirmStop: true, streamerName: 'DamDam', modeScenes: {}, chattingScene: 'Chatting' }, twitch: { connected: true, channelTitle: 'Soirée Minecraft Moddé', gameName: 'Minecraft', gameId: '27471' }, discord: { configured: true, channelName: 'planning' }, controlHub: { live: { isLive: live, title: live ? 'Soirée Minecraft Moddé' : null, category: 'Minecraft', durationSeconds: live ? 8072 : 0 }, audience: { viewerCount: live ? 17 : 0, chatters: live ? [{ id: 'u1', displayName: 'Mimi', role: 'moderator' }, { id: 'u2', displayName: 'Fred', role: 'vip' }] : [] }, chat: { connected: true, messages: live ? messages : [] }, integrations: { runtime: { status: 'CONNECTED' }, obs: { status: 'CONNECTED' }, twitch: { status: 'CONNECTED' }, streamlabs: { status: 'NOT_CONFIGURED' }, discord: { status: 'CONNECTED' }, wizebot: { status: 'NOT_CONFIGURED' } }, activity: live ? [{ type: 'support.received', occurredAt: now.toISOString(), payload: { displayName: 'DamFan' } }, { type: 'chat.message.received', occurredAt: now.toISOString(), payload: { chatter: { displayName: 'Mimi' } } }] : [] } },
    soundboard: { available: true, supportsExplicitOutputSelection: false, currentPlayback: null, sounds: [{ id: 'bonk', name: 'BONK', category: 'Réactions', volume: 1, favorite: true, enabled: true, sourceAvailable: true }, { id: 'creeper', name: 'CREEPER', category: 'Minecraft', volume: .8, favorite: true, enabled: true, sourceAvailable: true }, { id: 'gg', name: 'GG', category: 'Réactions', volume: .9, favorite: false, enabled: true, sourceAvailable: true }] }
  };
}
