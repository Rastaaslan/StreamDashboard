/** Vue en lecture seule des télécommandes associées à FIXE.
 * Un appairage enregistré ou un dernier contact ne prouvent jamais une présence en ligne.
 * Aucun identifiant, jeton, permission ni certificat n'est affiché.
 */
export function renderPairedDevicesSummary(devices, esc, now = Date.now()) {
  if (!Array.isArray(devices)) throw new Error('Liste des appareils associés invalide : état non vérifiable.');
  const associated = devices.filter(item => item && typeof item === 'object' && !item.revokedAt);
  const rows = associated.map(item => {
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Appareil sans nom';
    const timestamp = typeof item.lastSeenAt === 'string' ? Date.parse(item.lastSeenAt) : NaN;
    const lastSeen = Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now + 60000
      ? `Dernier contact enregistré : ${new Date(timestamp).toLocaleString('fr-FR')}`
      : 'Dernier contact non vérifiable';
    return `<li><strong>${esc(name)}</strong> <small>${esc(lastSeen)}</small></li>`;
  }).join('');
  return `<section data-paired-devices-summary><h2>Télécommandes associées à FIXE</h2>
    <p role="status">${associated.length} association(s) enregistrée(s) sur FIXE. Ces données ne prouvent pas la présence en ligne.</p>
    ${rows ? `<ul>${rows}</ul>` : '<p>Aucune télécommande associée enregistrée sur cette régie.</p>'}
    <p class="small muted">Le modèle Mono-PC / Double-PC et les appareils associés sont deux listes distinctes. Un téléphone peut être associé sans être déclaré dans le modèle.</p>
    <button type="button" class="secondary" data-task="close-dialog">Fermer</button></section>`;
}
