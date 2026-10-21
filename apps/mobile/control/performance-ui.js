const BANKS = [
  ['favorites', 'Favoris', 'star'],
  ['all', 'Tout', 'grid'],
  ['scenes', 'Scènes', 'scene'],
  ['alerts', 'Alertes', 'bell'],
  ['messages', 'Messages', 'message'],
  ['wizebot', 'WizeBot', 'bot'],
];
const BANK_IDS = new Set(BANKS.map(([id]) => id));
const MAX_FAVORITES = 128;
const LIVE_TYPES = new Set(['live.start', 'live.stop']);

function preferenceKey(scope) {
  const value = String(scope ?? 'local');
  if (value.length > 4096) throw new Error('Deck scope too long');
  return 'sd2.performance-deck.v1:' + encodeURIComponent(value || 'local');
}

function cleanFavorites(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(key => typeof key === 'string'
    && /^(action|sound):[^\x00-\x1f\x7f]{1,160}$/.test(key)))].slice(0, MAX_FAVORITES);
}

function normalizePreferences(value) {
  return {
    version: 1,
    bank: BANK_IDS.has(value?.bank) ? value.bank : 'favorites',
    soundCategory: typeof value?.soundCategory === 'string' ? value.soundCategory.slice(0, 128) : '',
    favorites: cleanFavorites(value?.favorites),
  };
}

/** Missing preferences are distinct from a deliberately empty favorites bank. */
export function readDeckPreferences(storage, scope) {
  try {
    const raw = storage?.getItem(preferenceKey(scope));
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || !Array.isArray(value.favorites)) return null;
    return normalizePreferences(value);
  } catch { return null; }
}

/** Returns null when this device cannot persist the preference. */
export function saveDeckPreferences(storage, scope, prefs) {
  try {
    if (typeof storage?.setItem !== 'function') return null;
    const value = normalizePreferences(prefs);
    storage.setItem(preferenceKey(scope), JSON.stringify(value));
    return value;
  } catch { return null; }
}

function availableActions(data) {
  return (Array.isArray(data?.configuration?.actions) ? data.configuration.actions : [])
    .filter(action => action && typeof action.id === 'string' && !LIVE_TYPES.has(action.type));
}

function soundCatalog(sounds) {
  return (Array.isArray(sounds?.sounds) ? sounds.sounds : [])
    .filter(sound => sound && typeof sound.id === 'string');
}

function chooseMicro(actions, data) {
  const microphones = actions.filter(action => action.type === 'mic.toggle');
  const primary = data?.host?.settings?.primaryMicInput;
  return (primary && microphones.find(action => action.value === primary))
    || (primary && microphones.find(action => !action.value))
    || microphones.find(action => action.value && data?.host?.state?.obs?.inputs?.[action.value])
    || microphones[0];
}

export function defaultDeckFavorites(data, sounds) {
  const actions = availableActions(data);
  const priority = {
    'replay.save': 1, 'mode.set': 2, 'scene.set': 2,
    'wizebot.command': 3, 'sound.play': 4, 'alert.play': 5,
    'chat.send': 6, 'timer.add': 7,
  };
  const micro = chooseMicro(actions, data);
  const selected = [
    ...(micro ? [micro] : []),
    ...actions.filter(action => action !== micro && Object.hasOwn(priority, action.type))
      .map((action, index) => ({ action, index }))
      .sort((a, b) => priority[a.action.type] - priority[b.action.type] || a.index - b.index)
      .map(({ action }) => action),
  ].slice(0, 6);
  return cleanFavorites([
    ...selected.map(action => 'action:' + action.id),
    ...soundCatalog(sounds).filter(sound => sound.favorite).map(sound => 'sound:' + sound.id),
  ]).slice(0, 12);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

const ICON_PATHS = {
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  muted: '<path d="m3 3 18 18M9 9v3a3 3 0 0 0 5.1 2.1M9 5V4a3 3 0 0 1 6 0v7M5 10v2a7 7 0 0 0 12 4.9M19 10v2a7 7 0 0 1-.4 2.3M12 19v3M8 22h8"/>',
  scene: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8M12 18v4m-2-14 5 3-5 3z"/>',
  volume: '<path d="m11 4-6 5H2v6h3l6 5zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
  clip: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.2 8.2 12 12M8.2 15.8 20 4M14 14l-3 3"/>',
  message: '<path d="M21 11a8 8 0 0 1-8 8H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4zM7 8h10M7 12h7"/>',
  bot: '<rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 7V3M10 3h4M1 12v4M23 12v4M8 16h8"/><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6M12 2v3m6 1 2-2"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="3"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  star: '<path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2-4.5-4.4 6.3-.9z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  edit: '<path d="m15 4 5 5M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15zM13 21h8"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.7 7M3 4v7h7M12 7v5l4 2"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name] || ICON_PATHS.grid}</svg>`;
}

function actionIcon(action, context) {
  if (action.type === 'mic.toggle') {
    const target = action.value || context.data?.host?.settings?.primaryMicInput;
    return context.online && context.obs.connected && context.obs.inputs?.[target]?.muted === true ? 'muted' : 'mic';
  }
  return ({
    'mode.set': 'scene', 'scene.set': 'scene', 'timer.add': 'timer',
    'sound.play': 'volume', 'sound.stop': 'stop', 'alert.play': 'bell',
    'chat.send': 'message', 'wizebot.command': 'bot', 'replay.save': 'clip',
    'replay.start': 'play', 'replay.stop': 'stop',
  })[action.type] || 'grid';
}

function sceneTarget(action, context) {
  const settings = context.data?.host?.settings || {};
  if (action.type === 'scene.set') return action.value;
  return action.value === 'chatting' ? settings.chattingScene : settings.modeScenes?.[action.value];
}

function commonState(context, allowBusy = false, localCapability = false) {
  if (!context.online && !(context.local && localCapability)) return context.local ? 'Régie nécessaire' : 'Régie déconnectée';
  if (context.blocked) return 'Synchronisation requise';
  if (context.busy && !allowBusy) return 'Action en cours';
  return '';
}

function soundState(sound, context) {
  const common = commonState(context, false, true);
  if (common) return { disabled: true, text: common, active: false };
  if (!sound.enabled) return { disabled: true, text: 'Son désactivé', active: false };
  if (!sound.sourceAvailable) return { disabled: true, text: 'Fichier indisponible', active: false };
  const playing = (context.sounds?.activePlaybacks || [context.sounds?.currentPlayback]).find(value => value?.soundId === sound.id);
  const active = Boolean(playing);
  return { disabled: false, text: active ? playing.status === 'starting' ? 'Chargement du son' : 'En lecture' : context.local ? 'Jouer sur cet appareil' : sound.category || 'Jouer le son', active };
}

function actionStatus(action, context) {
  const routed=context.routedStatus?.(action);
  if(routed)return {disabled:context.blocked||(context.busy&&routed.route.definition.type!=='sound.stop')||(routed.status==='unavailable'&&routed.reason!=='offline'),active:false,text:routed.status==='available'?'Sur '+routed.name:routed.status==='unknown'?'Vérifier · '+routed.name:routed.message+' · '+routed.name};
  if (action.type === 'sound.play') {
    const sound = context.catalog.find(item => item.id === action.value);
    return sound ? soundState(sound, context) : { disabled: true, text: 'Son à configurer', active: false };
  }
  if (context.local && action.type === 'sound.stop') {
    const active = Boolean(context.sounds?.currentPlayback);
    return { disabled: !active || context.blocked, text: active ? 'Arrêter la lecture locale' : 'Aucun son en cours', active: false };
  }
  if (context.local && action.type === 'wizebot.command') {
    const common = commonState(context, false, true);
    return { disabled: Boolean(common), text: common || 'Compte Twitch de cet appareil', active: false };
  }
  const common = commonState(context);
  if (common) return { disabled: true, text: common, active: false };
  if (action.type === 'wizebot.command' && !(context.data?.host?.chat?.connected && context.data?.host?.chat?.canSend)) {
    return { disabled: true, text: 'Twitch à reconnecter', active: false };
  }
  if (action.type === 'mic.toggle') {
    const target = action.value || context.data?.host?.settings?.primaryMicInput;
    const input = context.obs.inputs?.[target];
    if (!context.obs.connected) return { disabled: true, text: 'OBS déconnecté', active: false };
    if (!input || typeof input.muted !== 'boolean') return { disabled: true, text: 'Micro non confirmé', active: false };
    return { disabled: false, text: input.muted ? 'Micro coupé' : 'Micro ouvert', active: !input.muted, muted: input.muted };
  }
  if (['scene.set', 'mode.set'].includes(action.type)) {
    const target = sceneTarget(action, context);
    if (!context.obs.connected) return { disabled: true, text: 'OBS déconnecté', active: false };
    if (!target) return { disabled: true, text: 'Scène à configurer', active: false };
    const active = context.obs.scene === target;
    return { disabled: false, text: active ? 'À l’écran' : target, active };
  }
  if (action.type === 'replay.save' && context.replay?.active !== true) {
    return { disabled: true, text: 'Tampon à préparer', active: false };
  }
  let text;
  try { text = context.actionState?.(action); } catch { /* An incomplete snapshot remains usable. */ }
  return { disabled: false, text: text || 'Prêt', active: false };
}

function pad(item, context) {
  const { esc, editing, favoriteSet } = context;
  const isSound = item.kind === 'sound';
  const value = item.value;
  const label = String(isSound ? value.name || 'Son' : value.label || 'Commande');
  const state = isSound ? soundState(value, context) : actionStatus(value, context);
  const favorite = favoriteSet.has(item.key);
  const color = isSound ? 'green' : ['purple', 'green', 'amber', 'red'].includes(value.color) ? value.color : 'purple';
  const handler = editing ? `data-deck-favorite="${esc(item.key)}" aria-pressed="${favorite}"`
    : isSound ? `data-play-sound="${esc(value.id)}"` : `data-action="${esc(value.id)}"`;
  const text = editing ? favorite ? 'Dans vos favoris' : 'Ajouter aux favoris' : state.text;
  return `<button type="button" class="live-pad" data-color="${color}" data-kind="${item.kind}" data-active="${!editing && state.active}" data-muted="${!!state.muted}" data-favorite="${favorite}" ${handler} ${!editing && state.disabled ? 'disabled' : ''} aria-label="${esc(label + ' — ' + text)}"><span class="pad-icon">${icon(isSound ? 'volume' : actionIcon(value, context))}</span>${editing ? `<span class="pad-favorite" aria-hidden="true">${favorite ? '★' : '☆'}</span>` : ''}<span class="pad-label">${esc(label)}</span><span class="pad-state">${esc(text)}</span></button>`;
}

function dock(context) {
  const micro = chooseMicro(context.actions, context.data);
  const microState = micro ? actionStatus(micro, context) : { disabled: true, text: 'À configurer', active: false };
  const clipAction = context.actions.find(action => action.type === 'replay.save');
  const clipActive = context.online && context.replay?.active === true;
  const audioKnown = Boolean((context.online || context.local) && context.sounds?.currentPlayback);
  const standardBlock = Boolean(commonState(context));
  const editLabel = 'Terminez la sélection des favoris';
  const microHandler = !context.editing && micro ? `data-action="${context.esc(micro.id)}"` : '';
  const clipHandler = context.editing ? '' : clipActive ? `data-action="${context.esc(clipAction?.id || 'replay.save')}"` : 'data-deck-clips';
  const stopHandler = context.editing ? '' : 'data-action="sound.stop"';
  return `<div class="deck-dock" role="group" aria-label="Commandes rapides"><button type="button" class="deck-dock-button" ${microHandler} data-active="${microState.active}" data-muted="${!!microState.muted}" ${context.editing || microState.disabled ? 'disabled' : ''} aria-label="${context.esc((micro?.label || 'Micro') + ' — ' + (context.editing ? editLabel : microState.text))}"><span class="pad-icon">${icon(micro ? actionIcon(micro, context) : 'mic')}</span><span class="pad-label">Micro</span><span class="pad-state">${context.esc(context.editing ? 'En édition' : microState.text)}</span></button><button type="button" class="deck-dock-button" ${clipHandler} ${context.editing || standardBlock ? 'disabled' : ''}><span class="pad-icon">${icon('clip')}</span><span class="pad-label">${clipActive ? 'Clip' : 'Préparer clips'}</span><span class="pad-state">${context.esc(context.editing ? 'En édition' : commonState(context) || (clipActive ? `${Number(context.replay?.seconds) > 0 ? context.replay.seconds + ' s' : 'Tampon actif'}` : 'Ouvrir les réglages'))}</span></button><button type="button" class="deck-dock-button" data-tone="stop" ${stopHandler} ${context.editing || !audioKnown ? 'disabled' : ''}><span class="pad-icon">${icon('stop')}</span><span class="pad-label">Stop son</span><span class="pad-state">${context.esc(context.editing ? 'En édition' : !context.online && !context.local ? 'Régie déconnectée' : audioKnown ? 'Couper la lecture' : 'Aucun son en cours')}</span></button></div>`;
}

function concise(value, limit = 140) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + '…' : text;
}

function feedback(context) {
  const receipts = Array.isArray(context.data?.receipts) ? context.data.receipts : [];
  const latest = receipts[receipts.length - 1];
  const labels = { running: 'En cours', succeeded: 'Confirmé', failed: 'Échec', partial: 'Partiel', uncertain: 'À vérifier' };
  const status = Object.hasOwn(labels, latest?.status) ? latest.status : 'idle';
  const idleMessage = context.local ? 'Vos sons et commandes WizeBot utilisent cet appareil. Les commandes OBS nécessitent une régie.' : !context.online ? 'Retrouvez la régie pour utiliser les commandes.'
    : context.blocked ? 'Synchronisez vos réglages pour reprendre les commandes.'
    : context.editing ? 'Vos favoris sont enregistrés sur cet appareil.'
    : context.busy ? 'Une commande est en cours. Attendez sa confirmation.'
    : 'Touchez un bouton pour agir sur votre live.';
  return `<section class="deck-feedback" data-status="${context.esc(status)}" aria-live="polite"><div><strong>${context.esc(latest ? labels[status] || 'Dernière action' : 'Aucune action récente')}</strong><p>${context.esc(latest ? concise(latest.message) : idleMessage)}</p></div><button type="button" class="secondary" data-deck-log aria-label="Ouvrir le journal des actions">${icon('history')}<span>Journal</span></button></section>`;
}

function sessionBar(context) {
  const scene = context.obs.scene;
  const host = context.data?.host?.hostname || (context.local ? 'Cet appareil' : 'Régie');
  const state = context.local ? 'Espace autonome' : !context.online ? 'Régie déconnectée' : context.blocked ? 'Réglages à synchroniser' : context.obs.connected ? 'Régie connectée' : 'OBS déconnecté';
  const sceneText = context.local ? 'Lecture sur cet appareil' : context.online && context.obs.connected ? scene || 'Scène non confirmée'
    : scene ? 'Dernière scène · ' + scene : 'Scène non confirmée';
  return `<div class="deck-session-bar" data-online="${context.online}" data-blocked="${context.blocked}"><span class="deck-connection-dot" aria-hidden="true"></span><div><strong>${context.esc(state)}</strong><span>${context.esc(host)}</span></div><div><span>${context.online && context.obs.connected ? 'À l’écran' : 'Dernier état'}</span><strong>${context.esc(sceneText)}</strong></div></div>`;
}

/** Pure presentation: every executable pad uses the existing action dispatcher. */
export function renderPerformancePage(options = {}) {
  const esc = typeof options.esc === 'function' ? options.esc : escapeHtml;
  const actions = availableActions(options.data);
  const catalog = soundCatalog(options.sounds);
  const favorites = cleanFavorites(options.favorites);
  const mode = options.mode === 'sounds' ? 'sounds' : 'deck';
  const editing = options.editing === true;
  const bank = BANK_IDS.has(options.bank) ? options.bank : 'favorites';
  const soundCategory = typeof options.soundCategory === 'string' ? options.soundCategory : '';
  const context = { ...options, esc, actions, catalog, favorites, favoriteSet: new Set(favorites), editing,
    online: options.online === true, local: options.local === true, busy: options.busy === true, blocked: options.blocked === true,
    obs: options.data?.host?.state?.obs || {} };
  const actionItems = actions.map(value => ({ kind: 'action', key: 'action:' + value.id, value }));
  const soundItems = catalog.map(value => ({ kind: 'sound', key: 'sound:' + value.id, value }));
  const all = [...actionItems, ...soundItems];
  const byKey = new Map(all.map(item => [item.key, item]));
  let shown, title, tabs;
  if (mode === 'sounds') {
    const categories = [...new Set(catalog.map(sound => String(sound.category || '')).filter(category => category && category !== 'favorites'))];
    shown = soundItems.filter(item => !soundCategory || (soundCategory === 'favorites'
      ? editing || context.favoriteSet.has(item.key) : item.value.category === soundCategory));
    title = editing ? 'Choisir vos sons favoris' : soundCategory === 'favorites' ? 'Vos sons favoris' : soundCategory || 'Tous les sons';
    tabs = [['', 'Tous', 'volume'], ['favorites', 'Favoris', 'star'], ...categories.map(category => [category, category, 'volume'])]
      .map(([id, label, glyph]) => `<button type="button" data-sound-category="${esc(id)}" aria-pressed="${soundCategory === id}">${icon(glyph)}<span>${esc(label)}</span></button>`).join('');
  } else {
    shown = bank === 'favorites' ? editing ? all : favorites.map(key => byKey.get(key)).filter(Boolean)
      : bank === 'all' ? all
      : actionItems.filter(({ value }) => bank === 'scenes' ? ['mode.set', 'scene.set'].includes(value.type)
        : bank === 'alerts' ? value.type === 'alert.play'
        : bank === 'messages' ? value.type === 'chat.send' : value.type === 'wizebot.command');
    title = editing ? 'Choisir vos favoris' : BANKS.find(([id]) => id === bank)?.[1] || 'Favoris';
    tabs = BANKS.map(([id, label, glyph]) => `<button type="button" data-deck-bank="${id}" aria-pressed="${bank === id}">${icon(glyph)}<span>${label}</span></button>`).join('');
  }
  const empty = mode === 'sounds' ? !catalog.length ? 'Ajoutez vos sons dans la bibliothèque pour les retrouver ici.'
    : soundCategory === 'favorites' ? 'Choisissez les sons à garder à portée de main.' : 'Aucun son dans cette catégorie.'
    : bank === 'favorites' ? 'Choisissez vos scènes, commandes et sons préférés.' : 'Aucun bouton dans cette banque.';
  const emptyActions = `<div class="deck-empty"><span class="pad-icon">${icon(mode === 'sounds' ? 'volume' : 'grid')}</span><h3>${mode === 'sounds' ? 'Votre soundboard' : 'Votre Deck, à votre main'}</h3><p>${esc(empty)}</p>${!editing && (mode === 'sounds' ? catalog.length : all.length) ? '<button type="button" data-deck-edit>Choisir mes favoris</button>' : ''}<button type="button" class="secondary" data-page="manage">Ouvrir Gestion</button></div>`;
  return `<section class="live-deck" data-deck-mode="${mode}" data-editing="${editing}"><div class="deck-topline"><div><span class="eyebrow">${mode === 'sounds' ? 'VOS SONS EN UN GESTE' : 'LES COMMANDES DU LIVE'}</span><h1>${mode === 'sounds' ? 'Soundboard' : 'Mon Deck'}</h1></div><div class="deck-tools"><button type="button" class="secondary" data-deck-edit aria-pressed="${editing}" aria-label="${editing ? 'Terminer la sélection des favoris' : 'Choisir les boutons favoris'}">${icon(editing ? 'check' : 'edit')}<span>${editing ? 'Terminé' : 'Personnaliser'}</span></button></div></div>${sessionBar(context)}<div class="deck-banks" role="group" aria-label="${mode === 'sounds' ? 'Catégories de sons' : 'Banques du Deck'}">${tabs}</div><div class="deck-bank-header"><h2>${esc(title)}</h2><span>${shown.length} ${mode === 'sounds' ? 'son' : 'bouton'}${shown.length === 1 ? '' : 's'}</span></div>${editing ? '<p class="deck-editor-hint">Touchez les boutons à garder dans Favoris, puis choisissez Terminé pour revenir au live.</p>' : ''}${shown.length ? `<div class="live-pad-grid" role="group" aria-label="${esc(title)}">${shown.map(item => pad(item, context)).join('')}</div>` : emptyActions}${dock(context)}${feedback(context)}</section>`;
}
