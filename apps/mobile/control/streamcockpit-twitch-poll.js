/** F08: deliberate public Twitch poll, never a queued/offline action.
 * The only transport is the paired FIXE server. No local poll store, polling,
 * automatic confirm, blind retry or account-switch carryover.
 */
const PREVIEW = '/api/v1/twitch/advanced/poll/preview';
const CONFIRM = '/api/v1/twitch/advanced/poll/confirm';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safePoll = /^[A-Za-z0-9_-]{1,128}$/;

export function mountTwitchPoll(root, { request } = {}) {
  const doc = root.ownerDocument, view = doc.defaultView;
  const section = doc.createElement('section');
  section.className = 'cockpit-twitch-poll panel';
  section.setAttribute('aria-label', 'Créer un sondage Twitch');
  const heading = doc.createElement('h3'); heading.textContent = 'Sondage Twitch';
  const note = doc.createElement('p'); note.className = 'small muted';
  note.textContent = 'Gestion du canal requise. Un sondage devient public immédiatement après une seconde confirmation. Aucune action automatique.';
  const form = doc.createElement('form');
  const make = (text, type) => {
    const label = doc.createElement('label');
    label.textContent = text;
    const field = doc.createElement(type);
    field.setAttribute('aria-label', text);
    label.append(field);
    form.append(label);
    return field;
  };
  const title = make('Question du sondage Twitch', 'input');
  title.maxLength = 60; title.autocomplete = 'off';
  const choices = make('Réponses (2 à 5, une par ligne)', 'textarea');
  choices.rows = 4; choices.maxLength = 150;
  const duration = make('Durée du sondage', 'select');
  for (const seconds of [60,120,300,600,900]) {
    const option = doc.createElement('option');
    option.value = String(seconds); option.textContent = seconds < 60 ? seconds + ' s' : seconds / 60 + ' min';
    duration.append(option);
  }
  duration.value = '60';
  for (const field of [title, choices, duration]) {
    field.className = 'cockpit-poll-field';
    if (field.style) {
      field.style.width = '100%'; field.style.maxWidth = '100%';
      field.style.minWidth = '0'; field.style.boxSizing = 'border-box';
    }
  }
  const preview = doc.createElement('button');
  preview.type = 'submit'; preview.textContent = 'Prévisualiser sans publier';
  form.append(preview);
  const confirmation = doc.createElement('div');
  confirmation.hidden = true;
  const summary = doc.createElement('p'); summary.setAttribute('role', 'status');
  const acknowledgement = doc.createElement('label');
  const checkbox = doc.createElement('input'); checkbox.type = 'checkbox';
  acknowledgement.append(checkbox);
  const acknowledgementText = doc.createElement('span');
  acknowledgementText.textContent = 'Je confirme la création immédiate d’un sondage public Twitch.';
  acknowledgement.append(acknowledgementText);
  const publish = doc.createElement('button');
  publish.type = 'button'; publish.textContent = 'Confirmer et publier sur Twitch';
  confirmation.append(summary, acknowledgement, publish);
  const status = doc.createElement('p'); status.setAttribute('role', 'status');
  section.append(heading, note, form, confirmation, status);
  root.append(section);

  let disposed = false, online = false, sourceKey = '', accountKey = '', generation = 0;
  let busy = false, uncertain = false, approved, pending;
  const connected = () => !disposed && root.isConnected && online && !!sourceKey &&
    view?.navigator?.onLine !== false && doc.visibilityState !== 'hidden';
  const clearPreview = () => {
    pending = undefined; approved = undefined; confirmation.hidden = true;
    summary.textContent = ''; checkbox.checked = false;
  };
  const clearPrivate = () => {
    clearPreview(); title.value = ''; choices.value = ''; duration.value = '60';
  };
  const draw = () => {
    const enabled = connected() && !busy && !uncertain && typeof request === 'function';
    for (const field of [title, choices, duration]) field.disabled = !enabled;
    preview.disabled = !enabled;
    checkbox.disabled = !enabled || !pending;
    publish.disabled = !enabled || !pending || !checkbox.checked || Date.now() >= pending.expiresAt;
  };
  const invalidate = message => {
    generation++; busy = false; uncertain = false; clearPrivate();
    status.textContent = message; draw();
  };
  const draftFromForm = () => {
    const question = title.value.trim(), options = choices.value.split(/\r?\n/).map(v => v.trim());
    const secs = Number(duration.value);
    if (!question || [...question].length > 60 || options.length < 2 || options.length > 5 ||
        options.some(v => !v || [...v].length > 25) || new Set(options).size !== options.length ||
        ![60,120,300,600,900].includes(secs)) return null;
    return { title: question, choices: options, duration: secs };
  };
  for (const field of [title, choices, duration]) field.addEventListener('input', () => {
    if (disposed || busy) return;
    clearPreview(); status.textContent = 'Brouillon modifié : nouvelle prévisualisation nécessaire.';
    draw();
  });
  checkbox.addEventListener('change', draw);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!connected() || busy || uncertain || typeof request !== 'function') return;
    const draft = draftFromForm();
    if (!draft) { clearPreview();status.textContent = 'Question et réponses invalides (2 à 5 choix, maximum 25 caractères chacun).';draw();return; }
    clearPreview();
    const revision = ++generation, target = sourceKey;
    busy = true; draw(); status.textContent = 'Vérification Twitch depuis le FIXE, aucune publication…';
    try {
      const data = await request(PREVIEW,{draft},'POST',target);
      if (disposed || !connected() || revision !== generation || sourceKey !== target) return;
      if (data?.schemaVersion !== 1 || data.kind !== 'streamcockpit-poll-preview' ||
          !uuid.test(data.confirmationId) || !Number.isFinite(data.expiresAt) ||
          data.expiresAt <= Date.now() || data.expiresAt > Date.now() + 60_000 ||
          JSON.stringify(data.draft) !== JSON.stringify(draft)) throw new Error('UNVERIFIED_PREVIEW');
      pending = {id:data.confirmationId,expiresAt:data.expiresAt};
      approved = draft;
      summary.textContent = `Question : ${draft.title} · ${draft.choices.join(' / ')} · ${draft.duration} s. Expire dans moins d’une minute.`;
      confirmation.hidden = false; status.textContent = 'Prévisualisation seulement. Aucun sondage envoyé à Twitch.';
    } catch (error) {
      if (disposed || !connected() || revision !== generation) return;
      clearPreview();
      status.textContent = error?.status === 403 ? 'Permission de gestion Twitch manquante.' :
        error?.status === 409 ? 'Live Twitch/OBS ou conditions de sondage non confirmés sur le FIXE.' :
        error?.status === 429 ? 'Limite Twitch atteinte. Réessayez volontairement plus tard.' :
        'Prévisualisation indisponible. Aucune publication demandée.';
    } finally {
      if (!disposed && revision === generation) { busy = false;draw(); }
    }
  });
  publish.addEventListener('click', async () => {
    if (!connected() || busy || uncertain || typeof request !== 'function' ||
        !pending || !approved || !checkbox.checked || Date.now() >= pending.expiresAt) return;
    if (JSON.stringify(draftFromForm()) !== JSON.stringify(approved)) { clearPreview();draw();return; }
    const id = pending.id, revision = ++generation, target = sourceKey;
    // One-use ID is consumed on the client BEFORE any await, never retried.
    clearPreview(); busy = true; draw();
    status.textContent = 'Confirmation envoyée à Twitch : attente du reçu. Aucun nouvel envoi automatique.';
    try {
      const data = await request(CONFIRM,{confirmationId:id,confirmed:true},'POST',target);
      if (disposed || !connected() || revision !== generation || sourceKey !== target) return;
      if (data?.schemaVersion !== 1 || data.kind !== 'streamcockpit-poll-confirmation' ||
          data.status !== 'confirmed' || !safePoll.test(data.pollId)) throw new Error('UNVERIFIED_CONFIRMATION');
      title.value = ''; choices.value = ''; duration.value = '60';
      status.textContent = 'Sondage confirmé par Twitch. Vérifiez sa présence sur votre tableau de bord.';
    } catch {
      if (disposed || !connected() || revision !== generation) return;
      uncertain = true;
      title.value = ''; choices.value = '';
      status.textContent = 'Résultat de publication incertain. Vérifiez directement Twitch avant toute nouvelle création. Aucun renvoi automatique.';
    } finally {
      if (!disposed && revision === generation) { busy = false;draw(); }
    }
  });
  const offline = () => invalidate('Hors ligne : aucun sondage envoyé.');
  const onVisibility = () => invalidate('Vue suspendue ou réactivée : toute confirmation précédente est annulée.');
  const onlineEvent = () => invalidate('Connexion rétablie : préparez une nouvelle demande.');
  view?.addEventListener('offline', offline);
  view?.addEventListener('online', onlineEvent);
  doc.addEventListener('visibilitychange', onVisibility);
  status.textContent = 'Appareil déconnecté : aucun sondage préparé.';
  draw();
  return {
    update(context = {}) {
      if (disposed) return;
      const nextOnline = context.online === true;
      const nextSource = typeof context.sourceKey === 'string' ? context.sourceKey : '';
      const nextAccount = typeof context.accountKey === 'string' ? context.accountKey : '';
      const changed = online !== nextOnline || sourceKey !== nextSource || accountKey !== nextAccount;
      online = nextOnline; sourceKey = nextSource; accountKey = nextAccount;
      if (changed) invalidate(online ? 'Prêt pour une prévisualisation explicite.' : 'Source indisponible. Aucun sondage en attente.');
      draw();
    },
    destroy() {
      if (disposed) return;
      disposed = true; invalidate('Vue fermée.');
      view?.removeEventListener('offline',offline); view?.removeEventListener('online',onlineEvent);
      doc.removeEventListener('visibilitychange',onVisibility);
      section.remove();
    },
  };
}
