const platforms = ['twitch', 'youtube'];
const fresh = (value, now) => Number.isFinite(Date.parse(value?.observedAt)) && now - Date.parse(value.observedAt) >= -5_000 && now - Date.parse(value.observedAt) < 45_000;

export function liveControlState(data, online, now = Date.now()) {
  const host = data?.host || {}, obs = host.state?.obs || {}, configuration = data?.configuration || {};
  const running = (data?.receipts || []).some(receipt => receipt.status === 'running' && ['live.start', 'live.stop'].includes(receipt.action));
  const destinations = Object.fromEntries(platforms.map(platform => {
    const observed = host.platforms?.[platform], target = configuration.outputs?.[platform], output = host.outputStatus?.[platform];
    const sameBroadcast = platform !== 'youtube' || ((!observed?.id || observed.id === configuration.youtube?.broadcastId) && (!observed?.channelId || observed.channelId === configuration.youtube?.channelId));
    const currentObservation = online && sameBroadcast && fresh(observed, now);
    const live = currentObservation && typeof observed.live === 'boolean' ? observed.live : null;
    const sameOutput = output && output.kind === target?.kind && output.name === target?.name;
    const active = !online ? null : target?.kind === 'main'
      ? obs.connected && obs.streamingKnown !== false && typeof obs.streaming === 'boolean' ? obs.streaming : null
      : sameOutput && fresh(output, now) && typeof output.active === 'boolean' ? output.active : null;
    const configured = target && target.kind !== 'unconfigured' && (platform !== 'youtube' || Boolean(configuration.youtube?.broadcastId && configuration.youtube?.channelId));
    const transitioning = currentObservation && ['liveStarting', 'testStarting'].includes(observed?.broadcastState);
    const startBlockReason = platform === 'youtube' && currentObservation && live === false
      ? ['complete', 'revoked'].includes(observed?.broadcastState)
        ? 'Diffusion terminée : choisissez une nouvelle diffusion YouTube préparée.'
        : observed?.bound === false ? 'Diffusion sans flux lié : terminez sa préparation dans YouTube Studio.' : ''
      : '';
    // Unknown output state is not an invitation to start. Only YouTube can
    // finalize a known active ingestion that has not become a public live yet.
    const outputReadyForStart = active === false || (platform === 'youtube' && active === true);
    const canStart = online && obs.connected && !running && !transitioning && !startBlockReason && configured && live === false && outputReadyForStart;
    return [platform, { live, active, transitioning: Boolean(transitioning), configured: Boolean(configured), canStart: Boolean(canStart), startBlockReason, observedAt: observed?.observedAt, broadcastState: currentObservation ? observed?.broadcastState : null, ingestionStatus: currentObservation ? observed?.ingestionStatus : null, error: observed?.error || output?.error || '' }];
  }));
  const mainActive = online && obs.connected && obs.streamingKnown !== false && obs.streaming === true;
  const anyActive = mainActive || platforms.some(platform => destinations[platform].live === true || destinations[platform].active === true);
  const bothLive = platforms.every(platform => destinations[platform].live === true);
  const pending = running || platforms.some(platform => destinations[platform].transitioning);
  const unconfirmed = online && (!obs.connected || obs.streamingKnown === false || typeof obs.streaming !== 'boolean'
    || platforms.some(platform => destinations[platform].configured && (destinations[platform].live === null || destinations[platform].active === null)));
  return {
    destinations, running: pending, anyActive, mainActive, bothLive, unconfirmed: Boolean(unconfirmed),
    canStartBoth: !anyActive && platforms.every(platform => destinations[platform].canStart && destinations[platform].active === false),
    heading: !online ? 'Régie déconnectée' : pending ? 'Commande de diffusion en cours' : bothLive ? 'En direct sur Twitch et YouTube' : anyActive ? 'Diffusion en cours' : unconfirmed ? 'État de diffusion à vérifier' : 'Préparer votre live',
  };
}
