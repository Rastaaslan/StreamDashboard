/** Local, read-only DJI Mic 3 battery telemetry for the computer with the RX attached. */
export function createDjiMic3BatteryPanel(root, { read, notify = () => {} } = {}) {
  root.className = 'panel dji-battery-panel';
  root.innerHTML = '<div class="dji-battery-heading"><h2>🎙️ DJI Mic 3 · Batteries</h2>'
    + '<span class="small muted" data-dji-observed>En attente de lecture</span></div>'
    + '<div class="dji-battery-grid"><div class="dji-battery-cell"><b>TX1</b><span data-dji-tx1>Non vérifié</span></div>'
    + '<div class="dji-battery-cell"><b>TX2</b><span data-dji-tx2>Non vérifié</span></div>'
    + '<div class="dji-battery-cell"><b>RX</b><span data-dji-rx>Non décodé</span></div></div>'
    + '<p class="small muted" data-dji-relay aria-live="polite">Transmission locale sécurisée par l’agent Windows lorsque la régie associée est disponible.</p>'
    + '<p class="small muted" data-dji-detail>Jauges DJI lues sur le PC du récepteur et transmises à la régie. Aucun pourcentage inventé.</p>';
  const get = selector => root.querySelector(selector);
  let enabled = false, disposed = false, inflight = null, lastReadAt = 0;
  let snapshot = null, timer;
  const POLL_MS = 30_000;

  function display() {
    if (disposed) return;
    const rx = get('[data-dji-rx]'), observed = get('[data-dji-observed]');
    const detail = get('[data-dji-detail]');
    if (!enabled) { root.hidden = true; return; }
    root.hidden = false;
    if (!snapshot) {
      observed.textContent = 'Recherche du RX…';
      rx.textContent = 'Non décodé';
      for (const slot of [1, 2]) get('[data-dji-tx' + slot + ']').textContent = 'Vérification…';
      return;
    }
    if (snapshot.status !== 'ok') {
      observed.textContent = 'Lecture USB indisponible';
      for (const slot of [1, 2]) get('[data-dji-tx' + slot + ']').textContent = 'Inconnu';
      rx.textContent = 'Inconnu';
      detail.textContent = 'Récepteur non accessible sur cet ordinateur, ou pilote USB indisponible. Aucune ancienne mesure conservée comme actuelle.';
      return;
    }
    const age = Date.now() - Date.parse(snapshot.observedAt);
    if (!Number.isFinite(age) || age < -10_000 || age > 65_000) {
      snapshot = null;
      observed.textContent = 'Mesure périmée';
      for (const slot of [1, 2]) get('[data-dji-tx' + slot + ']').textContent = 'À actualiser';
      rx.textContent = 'Non décodé';
      return;
    }
    observed.textContent = 'Mesure USB · ' + new Date(snapshot.observedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    for (const slot of [1, 2]) {
      const row = snapshot.tx?.find(tx => tx.slot === slot);
      const node = get('[data-dji-tx' + slot + ']');
      node.classList.remove('succeeded', 'warn');
      if (!row?.connected) node.textContent = 'Non connecté au RX';
      else if (row.rawGauge == null) node.textContent = 'Connecté · batterie inconnue';
      else if (row.level === 'full' && row.calibration === 'rx-display-confirmed-tx2') {
        node.textContent = '●●●● Pleine · jauge DJI ' + row.rawGauge + '/7';
        node.classList.add('succeeded');
      } else {
        node.textContent = 'Connecté · niveau brut ' + row.rawGauge + '/7 (non calibré)';
      }
      if (row?.charging === true) node.textContent += ' · en charge';
    }
    rx.textContent = snapshot.rx?.rawGauge != null
      ? 'Niveau brut ' + snapshot.rx.rawGauge + '/7 (non calibré)'
      : 'Batterie non décodée';
    detail.textContent = 'TX2 : niveau 1/7 confirmé « plein » sur le RX ; autres niveaux et RX non étalonnés. Pas de pourcentage inventé.';
  }
  async function refresh() {
    if (disposed || !enabled || !root.isConnected || inflight || typeof read !== 'function') return;
    if (Date.now() - lastReadAt < POLL_MS - 1000) return;
    lastReadAt = Date.now();
    const current = Promise.resolve().then(read);
    inflight = current;
    try {
      const received = await current;
      if (disposed || !enabled || !root.isConnected) return;
      snapshot = received;
    } catch (error) {
      if (disposed || !enabled) return;
      snapshot = { status: 'unavailable', reason: 'read-error' };
      notify('DJI Mic 3 : lecture USB indisponible.');
    } finally {
      if (inflight === current) inflight = null;
      display();
    }
  }
  const tick = () => { if (!disposed && enabled) { display(); void refresh(); } };
  timer = setInterval(tick, 5_000);
  display();
  return {
    root,
    update(context) {
      enabled = context?.enabled === true;
      display();
      if (enabled && !snapshot) void refresh();
    },
    destroy() { disposed = true; clearInterval(timer); timer = undefined; },
  };
}
