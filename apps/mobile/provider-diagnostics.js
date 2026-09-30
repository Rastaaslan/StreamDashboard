import { CompanionMode } from './companion-store.js';

// Deliberately project known fields only: provider errors and OAuth payloads are untrusted.
const messages = {
  GOOGLE_PLAY_SERVICES: 'Services Google Play indisponibles : installer ou mettre à jour les services Google Play sur ce téléphone.',
  PREVIEW: 'Preview : providers autonomes désactivés dans cette build. Installer une release provisionnée.',
  RUNTIME_UNAVAILABLE: 'Provider Android indisponible : installer une build Android compatible.',
  CONFLICT: 'Cet événement a changé ailleurs : résoudre le conflit avant de republier.',
  NOT_CONFIGURED: 'Client ID absent : installer une version Android configurée pour ce service.',
  REAUTH_REQUIRED: 'Session expirée ou refusée : réautoriser ce compte.',
  HTTP_400: 'Requête refusée par le fournisseur : vérifier les champs du planning.',
  HTTP_404: 'Ressource fournisseur introuvable : synchroniser à nouveau.',
  HTTP_429: 'Limite fournisseur atteinte : réessayer plus tard.',
  HTTP_500: 'Erreur du fournisseur : réessayer plus tard.',
  HTTP_503: 'Fournisseur temporairement indisponible.',
  HTTP_403: 'Permissions insuffisantes : réautoriser le compte et vérifier les droits du calendrier.',
  SCOPES: 'Permissions manquantes : réautoriser ce compte.',
  CALENDAR: 'Le calendrier principal doit être accessible en écriture.',
  ACCOUNT: 'La publication du planning Twitch nécessite un compte affilié ou partenaire.',
  AUTH: 'Autorisation annulée ou échouée : relancer OAuth.',
  NETWORK: 'Test impossible : vérifier Internet puis retester.',
};
export const providerError = code => messages[code] || (/^HTTP_[45]\d{2}$/.test(code || '') ? `Le fournisseur a refusé la requête (${code}).` : 'Service indisponible : retester la connexion.');
const knownCapabilities = ['connect', 'disconnect', 'test', 'schedule', 'calendar', 'categories'];
const knownScopes = ['channel:manage:schedule', 'channel:read:schedule', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'];
export function providerDiagnostic(raw = {}) {
  const configured = raw.configured === true;
  const connected = raw.connected === true;
  const code = Object.hasOwn(messages, raw.code) || /^HTTP_[45]\d{2}$/.test(raw.code || '') ? raw.code : raw.code ? 'NETWORK' : '';
  return {
    code: code || (!configured ? 'NOT_CONFIGURED' : ''),
    configured, connected, requiresReauth: raw.requiresReauth === true || ['REAUTH_REQUIRED', 'SCOPES', 'HTTP_403'].includes(code),
    tested: raw.tested === true && !code,
    capabilities: Array.isArray(raw.capabilities) ? knownCapabilities.filter(value => raw.capabilities.includes(value) && (value === 'connect' ? configured : ['test', 'disconnect'].includes(value) ? connected : configured && connected && raw.tested === true && !code)) : [],
    scopes: Array.isArray(raw.scopes) ? knownScopes.filter(value => raw.scopes.includes(value)) : [],
    calendar: raw.calendar === 'primary' ? 'Principal' : 'Non vérifié',
    lastSync: Number.isSafeInteger(raw.lastSync) && raw.lastSync > 0 && raw.lastSync <= 8640000000000000 ? new Date(raw.lastSync).toISOString() : 'Jamais',
    error: code ? providerError(code) : !configured ? messages.NOT_CONFIGURED : '',
  };
}
export function capabilityAvailability(snapshot, capability) {
  if (!snapshot.configured) return { available: false, reason: snapshot.error || messages.NOT_CONFIGURED };
  if (!snapshot.capabilities?.includes(capability)) return { available: false, reason: snapshot.error || 'Action indisponible : connecter le compte puis tester ses permissions.' };
  return { available: true, reason: '' };
}
export function wizardState(snapshot, pending = false) {
  const step = !snapshot.configured ? 'configuration' : !snapshot.connected || snapshot.requiresReauth || pending ? 'oauth' : !snapshot.tested ? 'test' : 'ready';
  return { step, label: { configuration: 'Configuration', oauth: 'OAuth', test: 'Test', ready: 'Prêt' }[step], reason: snapshot.error || (pending ? 'Terminer OAuth dans le navigateur, ou relancer si annulé.' : '') };
}

// Select the active account before evaluating publication permissions. A phone
// snapshot must never disable the independent PC account (or vice versa).
export function planningPublicationPermissions({ mode, pcState, twitchCapabilities, phone = {} }) {
  if (mode === CompanionMode.ONLINE_STANDALONE) {
    return Object.fromEntries(Object.entries({ twitch: 'schedule', google: 'calendar' }).map(([provider, capability]) =>
      [provider, capabilityAvailability(phone[provider] || {}, capability)]));
  }
  const permission = reason => ({ available: !reason, reason });
  if (mode !== CompanionMode.ONLINE_PC) {
    return { twitch: permission('Connexion Internet ou PC requise pour publier.'), google: permission('Connexion Internet ou PC requise pour publier.') };
  }
  return {
    twitch: permission(!pcState?.twitch?.connected ? 'Twitch à connecter sur le PC.'
      : twitchCapabilities?.schedule === true ? ''
        : twitchCapabilities?.schedule === false ? 'Reconnecte Twitch sur le PC pour autoriser le planning.' : 'Permissions Twitch du PC en cours de vérification.'),
    google: permission(pcState?.google?.configured === false ? 'Google non provisionné sur ce PC.'
      : !pcState?.google?.connected ? 'Google à connecter sur le PC.'
        : !pcState.google.targetConfigured ? 'Calendrier Google cible à choisir sur le PC.' : ''),
  };
}
