/** Inject a session-scoped read function returning MarkerExport v1. No commands,
 * credentials, polling or transport ownership belong to this component. */
export function mountMomentsTimeline(root, { sessionId, read }) {
  const doc = root.ownerDocument;
  const section = doc.createElement('section');
  section.setAttribute('aria-label', 'Moments marquants');
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  const list = doc.createElement('ol');
  section.append(status, list);
  root.append(section);
  let disposed = false, generation = 0;
  const refresh = async () => {
    if (disposed) return;
    const request = ++generation;
    status.textContent = 'Chargement des moments…';
    try {
      const data = await read(sessionId);
      if (disposed || request !== generation) return;
      if (data?.schemaVersion !== 1 || data.kind !== 'streamcockpit-markers' || data.timebase !== 'unix-ms' ||
          data.sessionId !== sessionId || !Array.isArray(data.markers) || data.markers.some(m =>
            m.sessionId !== sessionId || !Number.isSafeInteger(m.instant) || m.instant < 0 ||
            m.instant > 8640000000000000 || !Number.isSafeInteger(m.sequence) || m.sequence < 1 ||
            typeof m.title !== 'string' || !['obs', 'twitch', 'manual', 'streamlabs'].includes(m.source) ||
            !['observed', 'confirmed', 'failed', 'uncertain'].includes(m.status))) throw new Error('INVALID_TIMELINE');
      list.replaceChildren();
      for (const m of [...data.markers].sort((a, b) => a.instant - b.instant || a.sequence - b.sequence)) {
        const item = doc.createElement('li');
        item.textContent = `${new Date(m.instant).toISOString()} · ${m.source} · ${m.title} · ${m.status}`;
        list.append(item);
      }
      status.textContent = data.markers.length ? `${data.markers.length} moment(s) · lecture seule` : 'Aucun moment pour cette session';
    } catch {
      if (disposed || request !== generation) return;
      list.replaceChildren();
      status.textContent = 'Moments indisponibles · actualisation nécessaire';
    }
  };
  void refresh();
  return { refresh, destroy() { disposed = true; generation++; section.remove(); } };
}
