# SC3 — Audit 03 : distinguer appairage, dernier contact et session WebSocket

**6 novembre 2026, 02 h 45–02 h 52 CET.** Correction ciblée exécutée **exclusivement via RDC sur FIXE**, dans le dépôt canonique et sa branche 3.0. Aucune installation, livraison, publication, action OBS/Twitch ou interaction avec un vrai Android/laptop.

## Préflight et propriétaire

- Lecture préalable des quatre documents d'autorité : PLAN, feature-matrix, CONTINUITY et MIGRATION_TO_FIXE_20261101.
- HEAD initial `5ffc385` (correctif distinct de conflit effacement/changement du mot de passe OBS) ; remote `https://github.com/Rastaaslan/StreamDashboard.git`, branche `streamcockpit/3.0-full-experience`, alignée sur origin.
- Aucun index.lock, merge/rebase ou verrou propriétaire actif. Environ cinq modifications **F05 + CONTINUITY** non commises, appartenant à un autre chantier, laissées intégralement intactes. Aucun fichier Settings appartenant à un propriétaire actif modifié.
- Processus OBS et QA Desktop présents sur FIXE : aucun contact/commande ; tests du serveur **éphémère** avec `obsEnabled:false` et `timerAuthority:false`, sans connexion ni ownership OBS. Pas de compilation distribution ni de test sur les appareils physiques.
- Modifications propres : `apps/server/src/index.ts`, `apps/mobile/control/control.js`, `apps/mobile/control/paired-devices-summary.js`, `tests/streamcockpit3-audit-remote-presence.test.ts`, `tests/streamcockpit3-audit-paired-devices.test.ts`, présent rapport. Ne pas indexer F05/CONTINUITY.

## Bug et correction

Le lot 01 distinguait la configuration locale des appareils effectivement associés à FIXE, mais les données du dernier contact ne permettaient pas de savoir si une **session WebSocket authentifiée** était encore ouverte. Une session ouverte n'établit pas non plus la présence physique, et une absence de WebSocket n'exclut pas les clients HTTP.

- Nouvelle route **GET locale protégée** `/api/v1/remote/devices/presence`, protégée par le même contrôle `requireLocal` que la liste des appareils associés, sans commande ni mutation. L'API retourne `observedAt` + les associations existantes enrichies de `webSocketOpen` calculé uniquement à partir des connexions WS authentifiées, encore à l'état `OPEN` lors du GET. `Cache-Control: private, no-store`. Cette vue exclut les sessions locales Electron via la fonction `remoteAuth.list()` déjà en place.
- L'interface FIXE **Appareils & Deck > Voir les appareils associés à FIXE** appelle cette route au clic uniquement ; rejette une réponse invalide sans fabriquer de statut ; affiche observation serveur, dernier contact, session WebSocket ouverte / aucune session WebSocket ouverte / inconnue, **sans assimiler cela à en ligne/hors ligne**. Les appareils révoqués restent filtrés ; noms HTML échappés ; identifiants, permissions, jetons et certificats non affichés.
- Aucun nouvel appairage, aucune seconde régie OBS et aucun rafraîchissement automatique. FIXE reste seul propriétaire OBS/minuteur ; comportement client/Android inchangé.

## Tests et résultats

- Test initial **RED** `tests/streamcockpit3-audit-remote-presence.test.ts` : **0 PASS / 1 FAIL** avant création de l'API (la route retombait sur un document HTML). Après ajout de la route, un échec du **harnais de test** a révélé que `ws-ticket` retourne HTTP **201**, pas 200 ; assertion corrigée sans modifier le contrat serveur.
- Test final ciblé :
  `SC3_AUDIT_BROWSER_TEST=1 SC3_SETTINGS_BROWSER_TEST=1 npx vitest run tests/streamcockpit3-audit-remote-presence.test.ts tests/streamcockpit3-audit-paired-devices.test.ts tests/streamcockpit3-settings-topology-browser.test.ts --maxWorkers=2 --testTimeout=30000`
  **21 PASS / 0 FAIL / 0 skipped**, trois suites ; **5 scénarios Microsoft Edge headless** inclus (formats mobile et bureau). Test HTTP vrai sur serveur éphémère et authentification WS via une adresse LAN de FIXE : association enregistrée sans socket = false, socket authentifiée ouverte = true, fermeture = false, client non privilégié distant = **403**, réponse sans credential ni ticket.
- `npm run build:types` **PASS** ; `npm run check:browser-types` **PASS** ; `node --check` pour les deux JS changés **PASS** ; `npm run security:check` **PASS** (6 767 fichiers, incluant l'arbre F05 préexistant) ; `git diff --check` **PASS** (warnings Windows LF/CRLF seulement).
- Aucune preuve Android/laptop physique, aucune mesure de heartbeat ou détection de coupure réseau silencieuse, aucune validation de présence au-delà du snapshot WebSocket et aucun test exhaustif sous charge. Un appareil HTTP-only peut être actif avec `webSocketOpen:false`.

## Suite / gates

Conserver la sémantique exacte : `webSocketOpen` n'est **pas** un booléen universel « connecté ». Une vraie disponibilité bout-en-bout nécessiterait un heartbeat authentifié, des délais et des simulations de partition réseau avant tout indicateur « en ligne ».
Poursuivre l'audit des statuts « prêt à diffuser » sur le dashboard classique et des doublons de paramètres restants, sans déplacer les secrets ni modifier F05. **G0/G1 historiquement qualifiés, G2 in_progress, G3–G5 open ; F00–F10 non promus.** QA installée `f15845b` préservée.
