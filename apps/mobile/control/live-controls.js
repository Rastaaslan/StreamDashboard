const platforms = ['twitch', 'youtube'];
const fresh = (value, now) => Number.isFinite(Date.parse(value?.observedAt)) && now - Date.parse(value.observedAt) >= -5_000 && now - Date.parse(value.observedAt) < 45_000;

export function liveControlState(data, online, now = Date.now()) {
  const host = data?.host || {}, obs = host.state?.obs || {}, configuration = data?.configuration || {};
  const running = (data?.receipts || []).some(receipt => receipt.status === 'running' && ['live.start', 'live.stop'].includes(receipt.action));
  const destinations = Object.fromEntries(platforms.map(platform => {
    const observed = host.platforms?.[platform], target = configuration.outputs?.[platform], output = host.outputStatus?.[platform];
    const sameBroadcast = platform !== 'youtube' || !observed?.id || observed.id === configuration.youtube?.broadcastId;
    const currentObservation = online && sameBroadcast && fresh(observed, now);
    const live = currentObservation && typeof observed.live === 'boolean' ? observed.live : null;
    const sameOutput = output && output.kind === target?.kind && output.name === target?.name;
    const active = !online ? null : target?.kind === 'main'
      ? obs.connected && obs.streamingKnown !== false ? Boolean(obs.streaming) : null
      : sameOutput && fresh(output, now) && typeof output.active === 'boolean' ? output.active : null;
    const configured = target && target.kind !== 'unconfigured' && (platform !== 'youtube' || Boolean(configuration.youtube?.broadcastId && configuration.youtube?.channelId));
    const transitioning = currentObservation && ['liveStarting', 'testStarting'].includes(observed?.broadcastState);
    const canStart = online && obs.connected && !running && !transitioning && configured && live === false;
    return [platform, { live, active, transitioning: Boolean(transitioning), configured: Boolean(configured), canStart: Boolean(canStart), observedAt: observed?.observedAt, broadcastState: currentObservation ? observed?.broadcastState : null, ingestionStatus: currentObservation ? observed?.ingestionStatus : null, error: observed?.error || output?.error || '' }];
  }));
  const mainActive = online && obs.connected && obs.streamingKnown !== false && obs.streaming === true;
  const anyActive = mainActive || platforms.some(platform => destinations[platform].live === true || destinations[platform].active === true);
  const bothLive = platforms.every(platform => destinations[platform].live === true);
  const pending = running || platforms.some(platform => destinations[platform].transitioning);
  return {
    destinations, running: pending, anyActive, mainActive, bothLive,
    canStartBoth: !anyActive && platforms.every(platform => destinations[platform].canStart && destinations[platform].active === false),
    heading: !online ? 'Régie déconnectée' : pending ? 'Commande de diffusion en cours' : bothLive ? 'En direct sur Twitch et YouTube' : anyActive ? 'Diffusion en cours' : 'Préparer votre live',
  };
}
