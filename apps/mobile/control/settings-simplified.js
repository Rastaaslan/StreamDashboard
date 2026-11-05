import { SETUPS } from '../shared/installation.js';

// Read-only topology presentation; presets never pair devices.
function deviceCard(kind, title, summary, detail, actions = '') {
  return `<section class="settings-device-card" data-device-kind="${kind}">
    <h3>${title}</h3>
    <p class="small"><strong>${summary}</strong></p>
    <p class="small muted">${detail}</p>${actions}
  </section>`;
}

export function renderDevicesSettings({
  data, device, installation, native, server, online, localEndpoint, deviceExecutor,
  macroConfigurationError, knownPairedServer, esc
}) {
  const current = installation && typeof installation === 'object' ? installation : null;
  const devices = Array.isArray(current?.devices) ? current.devices : [];
  const local = devices.find(item => item.id === current?.localDeviceId);
  const isMaster = local ? local.roles?.includes('obs-executor') : device?.role === 'stream';
  const isClient = device?.role === 'control';
  const androidDevices = devices.filter(item => item.platform === 'android' && item.enabled !== false);
  const presetLabel = current?.preset && SETUPS[current.preset] ? SETUPS[current.preset] : 'Non renseignée sur cet appareil';
  const deckPreset = current?.preset?.includes('-deck') || false;
  const masterConnected = Boolean(server && online);
  const masterName = masterConnected ? esc(data.host.hostname || 'FIXE') : 'FIXE';
  const masterSummary = isMaster ? 'Régie de cet ordinateur' : masterConnected ? 'Régie sélectionnée accessible' : 'Connexion à FIXE non vérifiée';
  const masterDetail = isMaster
    ? 'FIXE garde l’exécution OBS, les scènes et le minuteur. Les clients n’activent aucune seconde régie.'
    : 'Le laptop et Android doivent piloter cette régie. La seule configuration Double-PC ne garantit pas l’appairage.';
  const laptopSummary = isClient ? 'Cet ordinateur est un client' : 'PC jeu / client secondaire';
  const laptopDetail = 'Aucune horloge ou exécution OBS de secours n’est créée sur le laptop. Ses boutons agissent sur FIXE seulement après association autorisée.';
  const androidSummary = androidDevices.length
    ? androidDevices.map(item => esc(item.name)).join(', ') + ' · déclaré' + (androidDevices.length > 1 ? 's' : '')
    : deckPreset ? 'Prévu dans le modèle, pas encore enregistré ici' : 'Non déclaré dans cette installation';
  const androidDetail = androidDevices.length
    ? 'Appareil connu dans cette configuration. Son état de connexion réel doit être confirmé sur le téléphone et sur FIXE.'
    : 'Android Deck est l’application du téléphone, pas un module Windows à installer. Le modèle Double-PC ne l’ajoute pas automatiquement ; associez le téléphone directement à FIXE.';
  const controllerAction = isMaster
    ? '<button type="button" class="secondary" data-task="pairing">Créer un code d’association sur FIXE</button>'
    : '<button type="button" class="secondary" data-task="connection">Associer FIXE depuis cet appareil</button>';
  const localName = esc(device?.name || 'Cet appareil');

  return `<h2>Appareils et Android Deck</h2>
    <p class="small muted" data-topology-preset>Modèle de cet appareil : <strong>${esc(presetLabel)}</strong>.
      Le modèle décrit une organisation prévue ; il ne connecte ni n’installe les appareils.</p>
    <div class="settings-topology-grid">
      ${deviceCard('master', 'FIXE · régie maîtresse', masterSummary, masterDetail, isMaster ? '<button type="button" class="secondary" data-tab="obs">Configurer OBS sur FIXE</button>' : '')}
      ${deviceCard('client', 'Laptop · PC jeu', laptopSummary, laptopDetail, !isMaster && !native ? controllerAction : '')}
      ${deviceCard('android', 'Android Deck · téléphone', androidSummary, androidDetail,
        isMaster ? controllerAction : '<button type="button" class="secondary" data-page="deck">Voir mes boutons Deck</button>')}
    </div>
    <p class="small muted" role="status">Appareil courant : ${localName}. ${masterConnected ? 'Une régie sélectionnée répond à cette interface.' : 'Pas de connexion à une régie confirmée depuis cette interface.'}
    La liste des appareils est locale à cette installation ; elle ne prouve pas la présence en ligne du téléphone.</p>
    <div class="form-actions settings-primary-actions">
      <button type="button" data-task="device-setup">Voir mon installation et les rôles</button>
      <button type="button" class="secondary" data-page="actions">Configurer les boutons Deck</button>
      <button type="button" class="secondary" data-task="connection">Associer une régie</button>
    </div>
    <details class="settings-advanced"><summary>Comptes et connexions locales</summary>
      <p class="small muted">Les comptes et les jetons sont propres à chaque appareil. Associer Android au PC stream ne copie aucun secret du laptop.</p>
      <div class="form-actions">
        <button type="button" data-task="device-accounts">Mes comptes sur cet appareil</button>
        ${((isMaster && (localEndpoint || data.host.local)) || (native && deviceExecutor)) ? '<button type="button" class="secondary" data-task="pairing">Créer un code d’association</button><button type="button" class="secondary" data-task="local-permissions">Permissions des appareils</button><button type="button" class="secondary" data-task="transport">Connexion sécurisée de cet agent</button>' : ''}
        <button type="button" class="secondary" data-task="use-local">Ouvrir mon espace local</button>
        ${knownPairedServer ? '<button type="button" class="secondary" data-task="use-paired">Retrouver ma régie</button>' : ''}
        ${server ? '<button type="button" class="secondary" data-task="import-local">Transférer mes créations locales</button>' : ''}
      </div>
    </details>
    <details class="settings-advanced"><summary>Avancé · migration, sauvegardes et transferts</summary>
      <div class="form-actions">
        <button type="button" data-task="setup-migration">Changer d’installation</button>
        <button type="button" class="secondary" data-task="planning-handoff">Déplacer le planning</button>
        <button type="button" class="secondary" data-task="configuration-copy">Copier les configurations et macros</button>
        <button type="button" class="secondary" data-task="sound-library">Copier une bibliothèque audio</button>
      </div>
    </details>
    <details class="settings-advanced"><summary>Avancé · macros clavier</summary>
      <p class="small muted">Associez les touches de votre clavier aux raccourcis de Boutons &amp; macros. Sur BlackWidow V4 X, Synapse peut associer M1–M6 à Ctrl + Alt + Maj + F1–F6. Un seul ordinateur exécute chaque commande.</p>
      <button type="button" class="secondary" data-task="shortcut-status">Vérifier les raccourcis sur ce PC</button>
      <p id="shortcut-status" class="small muted" role="status">${esc(macroConfigurationError || '')}</p>
    </details>`;
}

export function settingsScope({ data, device, server, online, esc }) {
  if (server && online) {
    return `Régie sélectionnée : ${esc(data.host.hostname || 'FIXE')}. Les réglages de régie ciblent cet agent ; les comptes et secrets locaux restent sur leur appareil.`;
  }
  if (device?.role === 'control') {
    return 'PC client : les commandes OBS et le minuteur nécessitent FIXE. Associer la régie ne duplique pas OBS ni les comptes.';
  }
  return 'Réglages de cet appareil. Un modèle d’installation ne prouve pas qu’un autre appareil est associé ou connecté.';
}
