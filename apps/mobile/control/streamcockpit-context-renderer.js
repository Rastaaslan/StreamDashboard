/** @typedef {import('../../../packages/core/src/streamcockpit-context.js').ContextPresentation} ContextPresentation */
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const reasons = {
  'network-unavailable': 'Agent indisponible : réseau déconnecté ou inconnu',
  'capabilities-unknown': 'Capacités inconnues',
  'missing-capability': 'Capacité requise absente',
};
/**
 * Render-only adapter. Consume a validated core presentation. No action-routing
 * attributes, events, callbacks or executable controls; availability is advisory.
 * @param {ContextPresentation} presentation
 * @returns {string}
 */
export function renderContextPresentation(presentation) {
  return '<section class="sc-context-deck" aria-label="Deck contextuel">' +
    '<h2>' + escapeHtml(presentation.bank.label) + '</h2>' +
    '<p role="status">' + escapeHtml(presentation.network === 'online' ? 'Agent connecté' : 'Agent indisponible') + '</p>' +
    (presentation.unknownFields.length ? '<p>Contexte inconnu : ' + escapeHtml(presentation.unknownFields.join(', ')) + '</p>' : '') +
    '<ul>' + presentation.actions.map(action =>
      '<li aria-disabled="' + String(!action.available) + '"><span>' + escapeHtml(action.label) + '</span>' +
      '<small>' + escapeHtml(action.reason ? reasons[action.reason] : 'Présentation disponible') + '</small></li>'
    ).join('') + '</ul>' +
    (presentation.actions.length ? '' : '<p>Aucune action visible pour ce rôle.</p>') + '</section>';
}
/** Explicit replacement prevents stale cards after scene changes or disconnection.
 * @param {{innerHTML: string}} container
 * @param {ContextPresentation} presentation
 */
export function mountContextPresentation(container, presentation) {
  container.innerHTML = renderContextPresentation(presentation);
}
