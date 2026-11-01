import { exportJSON } from './export-json.js';

/** F09: a read-only view of the FIXE-owned observed journal. No local durable
 * cache, synthetic stream duration, provider command or background refresh. */
const sources = [
  ['all', 'Toutes les sources'],
  ['obs', 'OBS'],
  ['twitch', 'Twitch'],
  ['manual', 'Manuel'],
  ['streamlabs', 'Streamlabs'],
];
const statuses = [
  ['all', 'Tous les statuts'],
  ['observed', 'Observé'],
  ['confirmed', 'Confirmé'],
  ['failed', 'Échoué'],
  ['uncertain', 'Incertain'],
];
const validSource = new Set(sources.slice(1).map(([key]) => key));
const validStatus = new Set(statuses.slice(1).map(([key]) => key));

/** Inject a session-scoped read function returning MarkerExport v1. No commands,
 * credentials, polling or transport ownership belong to this component. */
export function mountMomentsTimeline(root, { sessionId, read }) {
  const doc = root.ownerDocument;
  const section = doc.createElement('section');
  section.setAttribute('aria-label', 'Moments marquants');
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  const list = doc.createElement('ol');
  const filters = doc.createElement('div');
  filters.setAttribute('class', 'cockpit-moments-filters');
  const makeFilter = (labelText, choices) => {
    const label = doc.createElement('label');
    label.textContent = labelText;
    const select = doc.createElement('select');
    select.setAttribute('aria-label', labelText);
    for (const [value, title] of choices) {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = title;
      select.append(option);
    }
    select.value = 'all';
    label.append(select);
    filters.append(label);
    return select;
  };
  const sourceFilter = makeFilter('Filtrer par source', sources);
  const statusFilter = makeFilter('Filtrer par statut', statuses);
  const summary = doc.createElement('p');
  summary.setAttribute('class', 'cockpit-moments-summary');
  summary.setAttribute('aria-label', 'Bilan des repères observés');
  filters.hidden = true;
  summary.hidden = true;
  const exportButton = doc.createElement('button');
  exportButton.setAttribute('type', 'button');
  exportButton.textContent = 'Exporter le bilan complet (JSON)';
  exportButton.hidden = true;
  section.append(status, list, filters, summary, exportButton);
  root.append(section);

  let disposed = false, generation = 0, records = [], exporting = false;
  const clear = () => {
    records = [];
    list.replaceChildren();
    filters.hidden = true;
    summary.hidden = true;
    summary.textContent = '';
    exportButton.hidden = true;
    exportButton.disabled = true;
  };
  const showFiltered = () => {
    if (disposed || filters.hidden) return;
    list.replaceChildren();
    const visible = records.filter(marker =>
      (sourceFilter.value === 'all' || marker.source === sourceFilter.value) &&
      (statusFilter.value === 'all' || marker.status === statusFilter.value));
    for (const marker of visible) {
      const item = doc.createElement('li');
      item.textContent = `${new Date(marker.instant).toISOString()} · ${marker.source} · ${marker.title} · ${marker.status}`;
      list.append(item);
    }
    status.textContent = visible.length === records.length
      ? `${records.length} moment(s) · lecture seule`
      : `${visible.length} sur ${records.length} moment(s) · filtres locaux, lecture seule`;
  };
  // Export ONLY a presently verified host-journal snapshot after explicit user
  // action. Reuse Android's native sharing bridge; never persist offline or
  // mistake marker spacing for the actual duration of a broadcast.
  exportButton.addEventListener('click', async () => {
    if (disposed || exportButton.hidden || exporting || !records.length) return;
    const current = generation;
    const markerSnapshot = records.map(({ source, status, title, instant, sequence }) =>
      ({ source, status, title, instant, sequence }));
    const count = (property, choices) => Object.fromEntries(choices.map(([key]) =>
      [key, markerSnapshot.filter(marker => marker[property] === key).length]));
    const report = {
      schemaVersion: 1, kind: 'streamcockpit-moments-report', readOnly: true,
      source: 'fixe-observed-journal', sessionId, timebase: 'unix-ms',
      markerCount: markerSnapshot.length, firstMarkerAt: markerSnapshot[0].instant,
      lastMarkerAt: markerSnapshot.at(-1).instant,
      liveDurationKnown: false,
      bySource: count('source', sources.slice(1)), byStatus: count('status', statuses.slice(1)),
      markers: markerSnapshot,
    };
    exporting = true;
    exportButton.disabled = true;
    try {
      await exportJSON(report, `StreamCockpit-bilan-${sessionId}.json`);
      if (!disposed && current === generation)
        status.textContent = 'Export du bilan demandé explicitement. Les heures décrivent les repères, pas la durée du live.';
    } catch {
      if (!disposed && current === generation)
        status.textContent = 'Export indisponible sur cet appareil : aucun fichier confirmé.';
    } finally {
      exporting = false;
      if (!disposed && current === generation) exportButton.disabled = false;
    }
  });
  sourceFilter.addEventListener('change', showFiltered);
  statusFilter.addEventListener('change', showFiltered);

  const refresh = async () => {
    if (disposed) return;
    const request = ++generation;
    clear(); // Never retain private markers while freshness is unknown.
    status.textContent = 'Chargement des moments…';
    try {
      const data = await read(sessionId);
      if (disposed || request !== generation) return;
      if (data?.readOnly !== true || data.schemaVersion !== 1 || data.kind !== 'streamcockpit-markers' || data.timebase !== 'unix-ms' ||
          data.sessionId !== sessionId || !Array.isArray(data.markers) || data.markers.length > 10000 ||
          data.markers.some(m => !m || typeof m !== 'object' ||
            m.sessionId !== sessionId || !Number.isSafeInteger(m.instant) || m.instant < 0 ||
            m.instant > 8640000000000000 || !Number.isSafeInteger(m.sequence) || m.sequence < 1 ||
            typeof m.title !== 'string' || !m.title.length || m.title.length > 240 ||
            !validSource.has(m.source) || !validStatus.has(m.status)))
        throw new Error('INVALID_TIMELINE');
      // Whitelist fields before display/export: correlation IDs, provider
      // metadata and unrecognized future fields never enter a shared report.
      records = data.markers.map(({ sessionId, source, status, title, instant, sequence }) =>
        ({ sessionId, source, status, title, instant, sequence }))
        .sort((a, b) => a.instant - b.instant || a.sequence - b.sequence);
      if (!records.length) {
        status.textContent = 'Aucun moment pour cette session';
        return;
      }
      const confirmed = records.filter(m => m.status === 'confirmed').length;
      const uncertain = records.filter(m => m.status === 'uncertain').length;
      // Earliest/latest observed markers do NOT establish actual live duration.
      const span = records.length > 1
        ? `Écart entre repères : ${Math.floor((records.at(-1).instant - records[0].instant) / 60000)} min`
        : 'Un seul repère : durée du live inconnue';
      summary.textContent = `${records.length} repère(s) observé(s) · ${confirmed} confirmé(s) · ${uncertain} incertain(s) · ${span}`;
      filters.hidden = false;
      summary.hidden = false;
      exportButton.hidden = false;
      exportButton.disabled = exporting;
      showFiltered();
    } catch {
      if (disposed || request !== generation) return;
      clear();
      status.textContent = 'Moments indisponibles · actualisation nécessaire';
    }
  };
  void refresh();
  return { refresh, destroy() {
    disposed = true;
    generation++;
    clear();
    section.remove();
  } };
}
