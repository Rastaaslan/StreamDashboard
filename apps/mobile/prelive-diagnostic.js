/** Read-only preflight. Unknown telemetry is never reported as a confirmed failure. */
export function diagnosePrelive({ state = {}, mode = 'ONLINE_PC', cache = {}, phone = {}, capabilities = null, now = Date.now() } = {}) {
  const checks = [];
  const add = (id, status, message, action, applicable = true) => checks.push({ id, status, message, action, applicable });
  const local = mode === 'ONLINE_STANDALONE';
  const pc = mode === 'ONLINE_PC';
  const obs = state.obs || {}, settings = state.settings || {};
  const na = id => add(id, 'ok', 'Non applicable en Standalone Android : le contrôle de diffusion nécessite le PC et OBS.', null, false);
  if (local) ['runtime', 'obs', 'microphone', 'scene', 'timer'].forEach(na);
  else {
    const age = now - Date.parse(state.at);
    const fresh = pc && Number.isFinite(age) && age >= -60000 && age < 90000;
    add('runtime', fresh ? 'ok' : 'warning', fresh ? 'État du PC récent.' : 'État PC absent ou ancien : reconnecter puis relancer le diagnostic.', 'connections');
    add('obs', !fresh ? 'warning' : obs.connected === true ? 'ok' : 'blocker', !fresh ? 'OBS non vérifiable hors connexion.' : obs.connected ? 'OBS connecté.' : 'OBS déconnecté : démarrage impossible.', 'connections');
    const mic = settings.primaryMicInput, input = obs.inputs?.[mic];
    const available = fresh && obs.connected;
    add('microphone', !available || !mic ? 'warning' : !input ? 'blocker' : input.muted || input.volume === 0 ? 'warning' : 'ok', !available ? 'Micro non vérifiable.' : !mic ? 'Choisir le micro principal.' : !input ? `Micro principal absent : ${mic}.` : input.muted || input.volume === 0 ? `Micro coupé ou volume nul : ${mic}.` : `Micro disponible : ${mic}. Le niveau sonore réel reste à tester.`, 'audio');
    // A mic outside the intro scene may intentionally become audible only in Live.
    if (available && input && Array.isArray(obs.activeAudioInputs) && !obs.activeAudioInputs.includes(mic)) add('microphone-scene', 'warning', 'Micro non audible dans la scène actuelle ; vérifier la scène Live.', 'audio');
    const scene = settings.modeScenes?.[settings.startMode || 'intro'];
    add('scene', !available || !settings.startMode ? 'warning' : !scene || !obs.scenes?.includes(scene) ? 'blocker' : 'ok', !available || !settings.startMode ? 'Scène de démarrage à vérifier sur le PC.' : !scene || !obs.scenes?.includes(scene) ? 'Scène de démarrage non configurée ou absente.' : `Scène de démarrage disponible : ${scene}.`, 'scenes');
    if (settings.requireTimerOverlayOnStart) {
      const known = available && Array.isArray(obs.browserInputs);
      const exists = settings.timerBrowserSource && obs.browserInputs?.includes(settings.timerBrowserSource);
      add('timer', !known ? 'warning' : exists ? 'ok' : 'blocker', !known ? 'Timer requis : vérification finale sur le PC au démarrage.' : exists ? 'Source timer présente ; son rafraîchissement sera validé au démarrage.' : 'Timer requis : Browser Source absente ou non configurée.', 'timer');
    } else add('timer', 'ok', 'Overlay timer facultatif.', null, false);
  }
  if (local) {
    na('twitch'); na('scopes');
  } else {
    const connected = state.twitch?.connected === true;
    add('twitch', connected && pc ? 'ok' : 'warning', connected && pc ? 'Twitch connecté.' : 'Twitch à reconnecter pour préparer le titre et la catégorie ; OBS peut diffuser indépendamment.', 'connections');
    const allowed = connected && pc ? capabilities?.updateChannel : undefined;
    add('scopes', allowed === true ? 'ok' : 'warning', allowed === true ? 'Autorisation de modifier le titre et la catégorie accordée.' : allowed === false ? 'Reconnecter Twitch avec channel:manage:broadcast pour préparer le live.' : 'Autorisations Twitch non vérifiées.', 'connections');
    if (['error', 'action-required'].includes(state.preflight?.status)) add('preparation', 'warning', state.preflight.error || 'Préparation Twitch à compléter.', 'twitch');
  }
  const planning = local ? [...(cache.planning || []), ...(cache.tombstones || [])] : state.planning || [];
  if (!local && planning.some(item => item.desiredPublication?.twitch === true)) {
    const allowed = pc && state.twitch?.connected ? capabilities?.schedule : undefined;
    add('planning-scopes', allowed === true ? 'ok' : 'warning', allowed === true ? 'Autorisation de publier le planning Twitch accordée.' : 'Publication Twitch demandée : vérifier channel:manage:schedule dans les connexions.', 'connections');
  }
  const pending = cache.pending?.length || 0;
  // Dashboard/remote CalendarItem uses providers; the Standalone store uses providerLinks.
  const links = item => [...Object.values(item.providers || {}), ...Object.values(item.providerLinks || {})].filter(Boolean);
  const conflicts = (cache.conflicts?.length || 0) > 0 || planning.some(item => item.conflict || links(item).some(link => link.status === 'conflict'));
  const failed = planning.some(item => Boolean(item.syncError) || links(item).some(link => (link.status === 'error' || link.deletedRemotely === true)));
  const syncing = planning.some(item => links(item).some(link => ['pending', 'syncing'].includes(link.status)));
  add('planning-sync', conflicts || pending || failed || syncing ? 'warning' : 'ok', conflicts ? 'Conflits de synchronisation à résoudre.' : pending ? `${pending} modification(s) locale(s) à synchroniser.` : failed ? 'Une publication du planning a échoué.' : syncing ? 'Publication du planning en cours.' : planning.length ? 'Planning sans synchronisation en attente connue.' : 'Aucun live planifié : un live improvisé reste possible.', 'planning');
  const providers = local ? [] : Object.values(state.controlHub?.integrations || {});
  const phoneError = local && Object.entries(phone).some(([provider, snapshot]) => snapshot.error || snapshot.requiresReauth || (planning.some(item => item.desiredPublication?.[provider]) && !snapshot.tested));
  const providerError = phoneError || providers.some(value => ['ERROR', 'REAUTH_REQUIRED', 'DEGRADED'].includes(String(value.status).toUpperCase())) || (!local && (state.twitch?.error || state.google?.error || state.discord?.error || state.google?.syncing || (state.google?.configured && state.google?.connected === false)));
  add('providers', providerError ? 'warning' : 'ok', providerError ? 'Un service signale une erreur : consulter les connexions.' : 'Aucune erreur de service signalée.', 'connections');
  return { status: checks.some(c => c.status === 'blocker') ? 'blocker' : checks.some(c => c.status === 'warning') ? 'warning' : 'ok', checkedAt: new Date(now).toISOString(), checks };
}

export const diagnosticLabels = { ok: 'OK', warning: 'Avertissement', blocker: 'Bloquant' };
