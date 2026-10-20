const FRESH_FOR_MS = 10_000;
const BADGES = { broadcaster: 'Diffuseur', moderator: 'Modérateur', vip: 'VIP', subscriber: 'Abonné' };
const bounded = (value, maximum = 2_000) => typeof value === 'string' ? value.slice(0, maximum) : '';

function loadStyles() {
  const href = new URL('./twitch-chat.css', import.meta.url).href;
  if (Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some(link => link.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = href; document.head.append(link);
}
function normalize(value) {
  if (!value || typeof value !== 'object' || !value.identity || !value.chat
      || !Array.isArray(value.chat.messages) || !value.capabilities
      || typeof value.accountConnected !== 'boolean') throw new Error('État du chat indisponible.');
  const id = bounded(value.identity.broadcasterId, 30), login = bounded(value.identity.userName, 25);
  const valid = /^\d+$/.test(id) && /^[a-zA-Z0-9_]{1,25}$/.test(login);
  const identity = { broadcasterId: valid ? id : '', userName: valid ? login : '',
    displayName: bounded(value.identity.displayName, 100) || (valid ? login : '') };
  return { identity, accountConnected: value.accountConnected && valid,
    capabilities: { chatRead: value.capabilities.chatRead === true, chatWrite: value.capabilities.chatWrite === true },
    chat: { connected: value.chat.connected === true,
      messages: value.chat.messages.filter(message => message && typeof message.id === 'string'
        && message.broadcasterId === identity.broadcasterId && message.chatter && typeof message.text === 'string').slice(-200) } };
}

/** Only the selected runtime's authenticated API; no web-login cookies or inferred permissions. */
export function createTwitchChat(root, { request, configure = () => {} } = {}) {
  loadStyles();
  root.className = 'twitch-native-chat';
  root.innerHTML = '<div class="twitch-chat-account"><p data-twitch-identity></p><button type="button" class="secondary" data-twitch-refresh aria-label="Actualiser le chat Twitch">Actualiser</button></div>'
    + '<p class="small muted" data-twitch-status role="status"></p>'
    + '<div class="twitch-chat-log" data-twitch-messages role="log" aria-label="Messages Twitch" aria-live="polite" aria-relevant="additions text"></div>'
    + '<form class="twitch-chat-compose" data-twitch-form><label>Message Twitch<textarea data-twitch-draft aria-label="Message Twitch" rows="2" maxlength="500" placeholder="Votre message…" autocomplete="off"></textarea></label>'
    + '<div class="twitch-chat-compose-footer"><span class="small muted" data-twitch-count>0 / 500</span><button type="submit" data-twitch-send>Envoyer</button></div>'
    + '<p class="small" data-twitch-result role="status"></p></form>'
    + '<button type="button" class="secondary twitch-chat-connect" data-twitch-config>Configurer le compte Twitch</button>';
  const get = selector => root.querySelector(selector);
  const identityLabel = get('[data-twitch-identity]'), status = get('[data-twitch-status]');
  const list = get('[data-twitch-messages]'), draft = get('[data-twitch-draft]');
  const send = get('[data-twitch-send]'), resultLabel = get('[data-twitch-result]');
  const nodes = new Map();
  let sourceKey = '', sourceLabel = '', online = false, snapshot = null, disposed = false;
  let generation = 0, flight, checkedAt = 0, receivedAt = 0, readError = false, sending = false, result = '';

  function fresh() { return !disposed && online && snapshot && !readError && Date.now() - receivedAt <= FRESH_FOR_MS; }
  function maySend() { return Boolean(fresh() && snapshot.accountConnected && snapshot.capabilities.chatWrite && typeof request === 'function'); }
  function setResult(message) { result = message; resultLabel.textContent = result; }
  function clearSource() {
    generation++; flight = undefined; snapshot = null; checkedAt = 0; receivedAt = 0; readError = false; sending = false;
    nodes.clear(); list.replaceChildren(); draft.value = ''; setResult('');
  }
  function drawMessages() {
    const messages = snapshot?.capabilities.chatRead ? snapshot.chat.messages : [];
    const pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 40, scrollTop = list.scrollTop;
    const ids = new Set(messages.map(message => message.id));
    for (const [id, node] of nodes) if (!ids.has(id)) { node.remove(); nodes.delete(id); }
    list.querySelector('[data-twitch-empty]')?.remove();
    messages.forEach((message, index) => {
      let node = nodes.get(message.id);
      if (!node) {
        node = document.createElement('article'); node.className = 'twitch-chat-message';
        const head = document.createElement('div'); head.className = 'twitch-chat-message-head';
        const name = document.createElement('strong'); name.dataset.chatName = '';
        const badges = document.createElement('span'); badges.dataset.chatBadges = '';
        const time = document.createElement('time'); time.dataset.chatTime = '';
        head.append(name, badges, time);
        const body = document.createElement('p'); body.dataset.chatText = '';
        node.append(head, body); nodes.set(message.id, node);
      }
      const name = node.querySelector('[data-chat-name]');
      name.textContent = bounded(message.chatter.displayName, 100) || bounded(message.chatter.login, 25) || 'Compte Twitch';
      name.style.color = /^#[0-9a-f]{6}$/i.test(message.chatter.color || '') ? message.chatter.color : '';
      node.querySelector('[data-chat-badges]').textContent = (Array.isArray(message.chatter.badges) ? message.chatter.badges : [])
        .filter(badge => BADGES[badge?.setId] && (badge.setId !== 'broadcaster' || message.chatter.id === snapshot.identity.broadcasterId))
        .map(badge => BADGES[badge.setId]).join(' · ');
      const date = new Date(message.receivedAt), time = node.querySelector('[data-chat-time]');
      time.textContent = Number.isFinite(date.getTime()) ? date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
      if (Number.isFinite(date.getTime())) time.dateTime = date.toISOString();
      node.querySelector('[data-chat-text]').textContent = bounded(message.text);
      if (list.children[index] !== node) list.insertBefore(node, list.children[index] || null);
    });
    if (!messages.length) {
      const empty = document.createElement('p'); empty.className = 'empty'; empty.dataset.twitchEmpty = '';
      empty.textContent = snapshot?.capabilities.chatRead ? 'Les nouveaux messages de cette chaîne apparaîtront ici.' : 'Aucun message à afficher pour cette source.';
      list.append(empty);
    }
    list.scrollTop = pinned ? list.scrollHeight : scrollTop;
  }
  function draw() {
    if (disposed) return;
    const confirmed = fresh(), identity = snapshot?.identity;
    identityLabel.textContent = identity?.userName
      ? (confirmed && snapshot.accountConnected ? 'Compte : ' : 'Dernier compte confirmé : ')
        + (identity.displayName || identity.userName) + ' (@' + identity.userName + ')' : 'Compte Twitch non confirmé';
    identityLabel.title = sourceLabel ? 'Source : ' + sourceLabel : '';
    if (!online) status.textContent = 'Source inaccessible · historique conservé, envoi désactivé.';
    else if (typeof request !== 'function') status.textContent = 'Mettez à jour cette source pour utiliser le chat connecté.';
    else if (readError || (snapshot && !confirmed)) status.textContent = 'État actuel non confirmé · envoi désactivé. Actualisez la source.';
    else if (!snapshot) status.textContent = 'Vérification du compte Twitch…';
    else if (!snapshot.accountConnected) status.textContent = 'Connectez Twitch sur cette source pour utiliser le chat.';
    else if (!snapshot.capabilities.chatRead) status.textContent = 'Lecture du chat non autorisée. Reconnectez Twitch pour accorder cet accès.';
    else status.textContent = snapshot.chat.connected ? 'Réception active · messages de votre chaîne.' : 'Réception interrompue · derniers messages conservés.';
    if (confirmed && snapshot.accountConnected && !snapshot.capabilities.chatWrite) status.textContent += ' Envoi non autorisé pour ce compte.';
    status.className = 'small ' + (confirmed && snapshot?.accountConnected && snapshot.capabilities.chatRead && snapshot.chat.connected ? 'succeeded' : 'muted');
    draft.disabled = !maySend() || sending;
    send.disabled = !maySend() || sending || !draft.value.trim() || draft.value.length > 500;
    send.textContent = sending ? 'Envoi en cours…' : 'Envoyer';
    get('[data-twitch-count]').textContent = draft.value.length + ' / 500';
    get('[data-twitch-refresh]').disabled = !online || Boolean(flight);
    get('[data-twitch-config]').hidden = Boolean(confirmed && snapshot.accountConnected && snapshot.capabilities.chatRead && snapshot.capabilities.chatWrite);
    resultLabel.textContent = result;
  }
  async function refresh(force = false) {
    if (disposed || !root.isConnected || !online || !sourceKey || typeof request !== 'function' || flight
        || (!force && Date.now() - checkedAt < 2_000)) return;
    checkedAt = Date.now();
    const current = generation, target = sourceKey;
    const operation = Promise.resolve().then(async () => {
      try {
        if (disposed || current !== generation || !online) return;
        const next = normalize(await request('/api/v1/twitch/chat/state', undefined, 'GET', target));
        if (disposed || current !== generation || target !== sourceKey || !online || !root.isConnected) return;
        if (snapshot?.identity.broadcasterId && snapshot.identity.broadcasterId !== next.identity.broadcasterId) {
          generation++; sending = false; draft.value = ''; setResult('Compte Twitch changé. Vérifiez l’expéditeur avant d’écrire.');
        }
        snapshot = next; receivedAt = Date.now(); readError = false; drawMessages();
      } catch {
        if (disposed || current !== generation || target !== sourceKey || !root.isConnected) return;
        readError = true;
      } finally {
        if (flight === operation) flight = undefined;
        if (!disposed && root.isConnected && target === sourceKey) draw();
      }
    });
    flight = operation; draw(); await operation;
  }
  get('[data-twitch-form]').addEventListener('submit', async event => {
    event.preventDefault(); event.stopPropagation();
    if (disposed || sending) return;
    if (!maySend()) { setResult('Envoi désactivé tant que ce compte et cette source ne sont pas confirmés.'); draw(); return; }
    const message = draft.value.trim();
    if (!message || message.length > 500) { draw(); return; }
    const current = generation, target = sourceKey, expectedBroadcasterId = snapshot.identity.broadcasterId;
    sending = true; setResult(''); draw();
    try {
      const receipt = await request('/api/v1/twitch/chat/messages', { message, expectedBroadcasterId }, 'POST', target);
      if (disposed || current !== generation || target !== sourceKey || !root.isConnected) return;
      if (!receipt || typeof receipt.messageId !== 'string' || !receipt.messageId) throw new Error('Résultat non confirmé.');
      draft.value = ''; setResult('Message envoyé par Twitch.'); void refresh(true);
    } catch {
      if (disposed || current !== generation || target !== sourceKey || !root.isConnected) return;
      setResult('Envoi non confirmé. Brouillon conservé : vérifiez le chat avant de réessayer.');
    } finally {
      if (!disposed && current === generation && target === sourceKey && root.isConnected) { sending = false; draw(); }
    }
  });
  draft.addEventListener('input', draw);
  draft.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault(); get('[data-twitch-form]').requestSubmit();
    }
  });
  get('[data-twitch-refresh]').addEventListener('click', () => { void refresh(true); });
  get('[data-twitch-config]').addEventListener('click', configure);
  draw();
  return {
    update(context = {}) {
      if (disposed) return;
      const nextKey = typeof context.sourceKey === 'string' ? context.sourceKey : '';
      if (nextKey !== sourceKey) { clearSource(); sourceKey = nextKey; }
      const nextOnline = context.online === true;
      if (online && !nextOnline) { generation++; flight = undefined; sending = false; }
      if (!online && nextOnline) checkedAt = 0;
      online = nextOnline; sourceLabel = bounded(context.sourceLabel, 100); draw(); void refresh();
    },
    refresh,
    destroy() { disposed = true; generation++; online = false; flight = undefined; },
  };
}
