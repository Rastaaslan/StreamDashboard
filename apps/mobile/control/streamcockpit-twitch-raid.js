// F08 raids: Twitch may automatically transfer viewers 90 seconds after a queued raid.
// Only the paired FIXE server may send it, after two separate voluntary gestures.
const PREVIEW = '/api/v1/twitch/advanced/raid/preview';
const CONFIRM = '/api/v1/twitch/advanced/raid/confirm';
const validLogin = /^[a-z0-9_]{4,25}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function mountTwitchRaid(root, { request } = {}) {
  const doc = root.ownerDocument, view = doc.defaultView;
  const section = doc.createElement('section');
  section.className = 'cockpit-twitch-raid panel';
  section.setAttribute('aria-label', 'Raid Twitch');
  const heading = doc.createElement('h3'); heading.textContent = 'Raid Twitch';
  const note = doc.createElement('p'); note.className = 'small muted';
  note.textContent = 'Un raid peut transférer automatiquement tous les spectateurs après 90 secondes. Cette action NE stoppe PAS OBS. Vérifiez la destination avant de confirmer.';
  const form = doc.createElement('form');
  const label = doc.createElement('label'); label.textContent = 'Destination du raid Twitch (sans @)';
  const input = doc.createElement('input'); input.type = 'text'; input.maxLength = 25;
  input.autocomplete = 'off'; input.setAttribute('aria-label', 'Destination du raid Twitch (sans @)');
  if (input.style) { input.style.width = '100%'; input.style.maxWidth = '100%'; input.style.boxSizing = 'border-box'; }
  label.append(input);
  const preview = doc.createElement('button'); preview.type = 'submit';
  preview.textContent = 'Vérifier la destination sans raid'; form.append(label, preview);
  const review = doc.createElement('div'); review.hidden = true;
  const summary = doc.createElement('p'); summary.setAttribute('role', 'status');
  const acknowledge = doc.createElement('label');
  const agree = doc.createElement('input'); agree.type = 'checkbox';
  const consentText = doc.createElement('span');
  consentText.textContent = 'Je confirme le raid vers cette chaîne et le transfert possible de mes spectateurs après 90 secondes.';
  acknowledge.append(agree, consentText);
  const publish = doc.createElement('button'); publish.type = 'button';
  publish.textContent = 'Demander le raid sur Twitch';
  review.append(summary, acknowledge, publish);
  const status = doc.createElement('p'); status.setAttribute('role', 'status');
  const reconcile = doc.createElement('button'); reconcile.type = 'button';
  reconcile.textContent = 'J\'ai vérifié l\'état du raid dans Twitch : autoriser une nouvelle demande';
  reconcile.hidden = true;
  section.append(heading, note, form, review, status, reconcile); root.append(section);

  let disposed = false, online = false, sourceKey = '', accountKey = '', revision = 0;
  let busy = false, uncertain = false, pending, confirming = false;
  const connected = () => !disposed && root.isConnected && online && !!sourceKey &&
    view?.navigator?.onLine !== false && doc.visibilityState !== 'hidden';
  const clearPreview = () => {
    pending = undefined; review.hidden = true; agree.checked = false; summary.textContent = '';
  };
  const draw = () => {
    const usable = connected() && !busy && !uncertain && typeof request === 'function';
    input.disabled = preview.disabled = !usable;
    agree.disabled = !usable || !pending;
    publish.disabled = !usable || !pending || !agree.checked || Date.now() >= pending.expiresAt;
    reconcile.hidden = !uncertain;
    reconcile.disabled = !connected() || confirming;
  };
  const invalidate = message => {
    ++revision;
    if (confirming) uncertain = true; // An in-flight public POST may already have reached Twitch.
    busy = false; clearPreview(); input.value = '';
    status.textContent = uncertain
      ? 'Issue du raid incertaine : vérifiez le décompte ou l’annulation dans Twitch avant toute nouvelle demande. Aucun renvoi automatique.'
      : message;
    draw();
  };
  const login = () => {
    const value = input.value.trim().toLowerCase();
    return validLogin.test(value) ? value : null;
  };
  input.addEventListener('input', () => {
    if (disposed || busy) return;
    clearPreview(); status.textContent = 'Destination modifiée : recommencez la vérification.'; draw();
  });
  agree.addEventListener('change', draw);
  reconcile.addEventListener('click', () => {
    if (!connected() || busy || confirming || !uncertain) return;
    uncertain = false; ++revision; clearPreview(); input.value = '';
    status.textContent = 'État du raid vérifié manuellement dans Twitch : une nouvelle prévisualisation reste obligatoire.';
    draw();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!connected() || busy || uncertain || typeof request !== 'function') return;
    const targetLogin = login();
    if (!targetLogin) {
      clearPreview(); status.textContent = 'Nom Twitch invalide (4 à 25 caractères, sans @).'; draw(); return;
    }
    clearPreview(); const key = ++revision, source = sourceKey; busy = true; draw();
    status.textContent = 'Vérification de la destination et des autorisations sur FIXE…';
    try {
      const result = await request(PREVIEW, { target: { login: targetLogin } }, 'POST', source);
      if (disposed || !connected() || key !== revision || source !== sourceKey) return;
      if (result?.schemaVersion !== 1 || result.kind !== 'streamcockpit-raid-preview' ||
          !uuid.test(result.confirmationId) || result.targetLogin !== targetLogin ||
          !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now() ||
          result.expiresAt > Date.now() + 45_000) throw Error('INVALID_RAID_PREVIEW');
      pending = { id: result.confirmationId, login: targetLogin, expiresAt: result.expiresAt };
      summary.textContent = 'Destination vérifiée : ' + targetLogin +
        '. Attention : Twitch peut transférer automatiquement les spectateurs après 90 secondes.';
      review.hidden = false; status.textContent = 'Prévisualisation seulement : aucun raid demandé.';
    } catch (cause) {
      if (disposed || !connected() || key !== revision) return;
      clearPreview();
      status.textContent = cause?.status === 403 ? 'Droit Twitch channel:manage:raids ou gestion FIXE absent.' :
        cause?.status === 409 ? 'Destination introuvable ou direct FIXE non confirmé.' :
        cause?.status === 429 ? 'Limite Twitch atteinte : aucun raid demandé.' :
        'Vérification impossible : aucun raid demandé.';
    } finally { if (!disposed && key === revision) { busy = false; draw(); } }
  });
  publish.addEventListener('click', async () => {
    if (!connected() || busy || uncertain || !pending || !agree.checked ||
        Date.now() >= pending.expiresAt || typeof request !== 'function') return;
    if (login() !== pending.login) { clearPreview(); draw(); return; }
    const key = ++revision, source = sourceKey, id = pending.id, destination = pending.login;
    clearPreview(); busy = true; confirming = true; draw();
    status.textContent = 'Raid demandé. Résultat éventuellement incertain : aucun renvoi automatique.';
    try {
      const result = await request(CONFIRM, { confirmationId: id, confirmed: true }, 'POST', source);
      if (disposed || !connected() || key !== revision || source !== sourceKey) return;
      if (result?.schemaVersion !== 1 || result.kind !== 'streamcockpit-raid-confirmation' ||
          result.status !== 'queued' || result.targetLogin !== destination ||
          result.transferVerified !== false) throw Error('INVALID_RAID_RECEIPT');
      input.value = '';
      status.textContent = 'Twitch a accepté la préparation du raid. Le transfert réel n’est PAS vérifié : contrôlez Twitch (décompte de 90 secondes et option Annuler). OBS reste inchangé.';
    } catch {
      if (disposed || !connected() || key !== revision) return;
      uncertain = true; input.value = '';
      status.textContent = 'Issue du raid incertaine : vérifiez le décompte ou l’annulation dans Twitch avant toute nouvelle demande. Aucun renvoi automatique.';
    } finally {
      confirming = false;
      if (!disposed) { if (key === revision) busy = false; draw(); }
    }
  });
  const offline = () => invalidate('Hors ligne : raid désactivé.');
  const reconnect = () => invalidate('Connexion rétablie : nouvelle vérification obligatoire.');
  const visibility = () => invalidate('Vue suspendue ou reprise : ancienne confirmation invalidée.');
  view?.addEventListener('offline', offline); view?.addEventListener('online', reconnect);
  doc.addEventListener('visibilitychange', visibility);
  status.textContent = 'Source non associée : raid indisponible.'; draw();
  return {
    update(context = {}) {
      if (disposed) return;
      const nextOnline = context.online === true;
      const nextSource = typeof context.sourceKey === 'string' ? context.sourceKey : '';
      const nextAccount = typeof context.accountKey === 'string' ? context.accountKey : '';
      const changed = online !== nextOnline || sourceKey !== nextSource || accountKey !== nextAccount;
      online = nextOnline; sourceKey = nextSource; accountKey = nextAccount;
      if (changed) invalidate(online ? 'Prêt à vérifier un raid.' : 'Source déconnectée : raid indisponible.');
      draw();
    },
    destroy() {
      if (disposed) return;
      disposed = true; invalidate('Vue fermée.');
      view?.removeEventListener('offline', offline); view?.removeEventListener('online', reconnect);
      doc.removeEventListener('visibilitychange', visibility); section.remove();
    },
  };
}
