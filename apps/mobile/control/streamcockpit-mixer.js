/** Read-only view; injected authenticated reader owns transport. */
export function mountMixerTable(root, { read, onData = () => {} }) {
  const doc = root.ownerDocument;
  const section = doc.createElement('section');
  section.setAttribute('aria-label', 'Mixeur audio — lecture seule');
  section.setAttribute('class', 'cockpit-mixer');
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  const table = doc.createElement('table');
  section.append(status, table);
  root.append(section);
  let disposed = false, generation = 0;
  const display = value => {
    if (value?.state === 'unknown') return `Inconnu (${value.reason})`;
    if (value?.state !== 'known') throw new Error('INVALID_READING');
    return typeof value.value === 'boolean' ? (value.value ? 'Oui' : 'Non') : String(value.value);
  };
  const refresh = async () => {
    if (disposed) return;
    const current = ++generation;
    table.replaceChildren();
    status.textContent = 'Chargement…';
    try {
      const data = await read();
      if (disposed || current !== generation) return;
      if (data?.schemaVersion !== 1 || data.readOnly !== true || !Array.isArray(data.sources) || !Array.isArray(data.errors) || !Array.isArray(data.outputs)) throw new Error('INVALID_MIXER');
      onData(data);
      const head = doc.createElement('tr');
      for (const label of ['Source', 'Gain (×)', 'Muet', 'Niveau (amplitude)', 'Route stream', 'Route monitor', 'Route VOD', 'Périphérique']) {
        const cell = doc.createElement('th'); cell.textContent = label; head.append(cell);
      }
      table.replaceChildren(); table.append(head);
      for (const source of data.sources) {
        const row = doc.createElement('tr');
        for (const value of [source.name, ...['gain', 'mute', 'level', 'stream', 'monitor', 'vod', 'device'].map(k => display(source[k]))]) {
          const cell = doc.createElement('td'); cell.textContent = value; row.append(cell);
        }
        table.append(row);
      }
      status.textContent = `Lecture seule · ${data.owner} · révision ${data.revision} · ${data.sources.length} source(s) · sorties locales : ${data.outputs.map(o => `${o.name} (${o.selectable ? 'sélectionnable' : 'indisponible'})`).join(', ') || 'aucune observée'}${data.errors.length ? ` · Erreurs : ${data.errors.join(', ')}` : ''}`;
    } catch {
      if (disposed || current !== generation) return;
      table.replaceChildren(); status.textContent = 'Mixeur indisponible · actualisation nécessaire';
    }
  };
  void refresh();
  return { refresh, destroy() { disposed = true; generation++; section.remove(); } };
}
