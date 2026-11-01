import { selectContextPresentation } from './streamcockpit-context-core.js';
import { renderContextPresentation } from './streamcockpit-context-renderer.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const neutralConfig = {
  schemaVersion: 1, platform: 'twitch', actions: [], rules: [],
  banks: [{ id: 'unverified', label: 'Sélection contextuelle suspendue', actionIds: [] }],
  fallbackBankId: 'unverified',
};
/** Mounted preview only. A synchronized replica and local installation preferences
 * are NOT evidence of master provenance, fresh game/scene or OAuth permissions.
 * No command IDs, callbacks, persisted selection or synthetic role are accepted.
 */
export function renderContextPreview({ online = false, server = '', actions = [] } = {}) {
  const presentation = selectContextPresentation(neutralConfig, {
    scene: null, game: null, streamState: null, role: null, capabilities: null,
    network: online && server ? 'unknown' : 'offline',
  });
  const catalog = Array.isArray(actions) ? actions.slice(0, 512) : [];
  return '<section class="panel" data-context-preview data-status="unknown" style="min-width:0;max-width:100%;overflow-wrap:anywhere">' +
    '<h2>Deck contextuel · aperçu</h2>' +
    '<p role="status">UNKNOWN · ' + (online && server ?
      'Liaison rétablie ou disponible ; contexte maître non vérifié.' :
      'Régie hors ligne ou non associée ; contexte neutralisé.') + '</p>' +
    '<p>Scène, jeu, rôle authentifié, scopes et fraîcheur du maître FIXE restent à vérifier. Aucune commande contextuelle activée.</p>' +
    renderContextPresentation(presentation) +
    '<details><summary>Consulter les libellés configurés (' + catalog.length + ')</summary>' +
    '<p>Copie de configuration, pas un état mesuré ni une autorisation. Aucun bouton de cet aperçu ne lance de macro.</p>' +
    '<ul>' + catalog.map(action => '<li aria-disabled="true">' + escape(action?.label) + '</li>').join('') + '</ul></details>' +
    '<p>Les banques manuelles ci-dessous utilisent le circuit de commande existant. Elles ne sont pas une sélection contextuelle validée.</p></section>';
}
