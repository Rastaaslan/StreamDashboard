const labels = {unknown:'Inconnu', healthy:'Sain', degraded:'Dégradé', critical:'Critique'};
const names = {host:'Hôte', obs:'OBS', twitch:'Twitch', micro:'Micro', dji:'DJI', sync:'Synchronisation'};

/** Inject reports from the authenticated host transport. No polling, device bridge,
 * command capability or HTML interpolation. Call unavailable on transport loss. */
export function mountStreamCockpitHealth(root) {
  const document = root.ownerDocument;
  const panel = document.createElement('section');
  panel.className = 'streamcockpit-health panel';
  panel.setAttribute('aria-label', 'Centre de santé');
  const heading = document.createElement('h2');
  heading.textContent = 'Centre de santé';
  const summary = document.createElement('p');
  summary.setAttribute('role', 'status');
  const list = document.createElement('ul');
  panel.append(heading, summary, list);
  root.append(panel);
  let disposed = false;
  let expiry;
  function unavailable() {
    if (disposed) return;
    clearTimeout(expiry);
    summary.textContent = 'Inconnu — télémétrie hôte indisponible';
    list.replaceChildren();
  }
  unavailable();
  return {
    unavailable,
    update(report) {
      if (disposed) return;
      if (report?.schemaVersion !== 1 || !labels[report.status] || !Array.isArray(report.diagnostics)) { unavailable(); return; }
      clearTimeout(expiry);
      const ages = report.diagnostics.filter(d => d.freshness === 'fresh').map(d => Number.isFinite(d.ageMs) ? d.ageMs : 15000);
      expiry = setTimeout(unavailable, Math.max(0, 15000 - Math.max(0, ...ages)));
      summary.textContent = `${labels[report.status]} — ${report.hostId}`;
      list.replaceChildren();
      for (const diagnostic of report.diagnostics) {
        const row = document.createElement('li');
        row.dataset.status = labels[diagnostic.status] ? diagnostic.status : 'unknown';
        const timestamp = Number.isFinite(diagnostic.observedAt) && Math.abs(diagnostic.observedAt) <= 8.64e15
          ? new Date(diagnostic.observedAt).toISOString() : 'horodatage absent';
        const battery = diagnostic.source === 'dji' && diagnostic.status !== 'unknown' && diagnostic.freshness === 'fresh'
          && Number.isFinite(diagnostic.batteryPercent) && diagnostic.batteryPercent >= 0 && diagnostic.batteryPercent <= 100
          ? ` — ${diagnostic.batteryPercent} % mesurés` : '';
        row.textContent = `${names[diagnostic.source] || diagnostic.source} : ${labels[row.dataset.status]} — ${diagnostic.code}${battery} — ${diagnostic.provenance || 'provenance absente'} — ${timestamp} — ${diagnostic.freshness}`;
        list.append(row);
      }
    },
    destroy() { clearTimeout(expiry); disposed = true; panel.remove(); }
  };
}
