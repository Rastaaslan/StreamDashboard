# CB-132 — couche commune d’interaction Desktop

Base auditée : `1a39a25`. Aucun changement CodexBridge, infrastructure ou publication.

## Causes établies

Deux défauts ont été reproduits dans Chromium avec les fichiers JavaScript de
`1a39a25` servis par interception Playwright, sur le serveur local réel :

- Un double-clic sur Enregistrer dans Soundboard émet **deux PUT**. Le verrou
  `dialogCreation` ne protégeait que les créations, pas les éditions.
- Ouvrir la suppression par période alors que Soundboard est ouverte laisse
  **deux dialogues natifs ouverts**. Chaque surface appelait `showModal()` sans
  coordination. Le dialogue inférieur reste inert sous le backdrop du supérieur.
  La seconde ouverture est déclenchée par JavaScript dans cette reproduction,
  pour reproduire une ouverture concurrente/asynchrone malgré l’inert natif.

La lecture du code montre aussi qu’une ouverture Planning attendant les templates
pouvait survenir après l’ouverture d’une autre fenêtre, et que les réponses OBS
n’étaient pas liées à leur session. Ces chemins sont désormais protégés.

La course close → reopen est une protection défensive : Chromium 1243 coalesce
l’ancien événement `close` dans la reproduction native immédiate (aucun événement
ancien reçu). Il ne faut donc **pas compter les événements close attendus** : un
compteur non décrémenté avalerait le prochain Escape réel. Le gestionnaire utilise
l’état ouvert et l’identité de session, et le stress vérifie ce prochain Escape.
Aucun overlay CSS orphelin ni scroll lock persistant n’a été reproduit.

## Contrat commun

`apps/web/dialog-drafts.js` conserve les révisions/drafts CB-120 et devient le point
commun d’ouverture/fermeture de Planning preview/legacy, onboarding, Soundboard,
configuration OBS et suppression par période :

- `openDialog` ferme la session précédente avant de créer la suivante ; le top
  layer natif reste responsable du backdrop, de l’inert et du focus trap.
- `closeDialog` livre le teardown immédiatement et une seule fois. Les événements
  natifs tardifs sans session, ou visant un dialogue déjà rouvert, sont ignorés.
- `reserveDialogOpen` invalide une ouverture Planning retardée lorsqu’une autre
  ouverture intervient. Les complétions OBS/bulk sont liées à leur brouillon.
- Le verrou de session couvre créations, éditions et suppressions Planning/sons,
  et la réparation OBS. `finally` le libère après erreur pour autoriser un retry.
  Une ancienne complétion ne libère pas le verrou d’une nouvelle session.
- Le DOM des champs ouverts reste le draft. Les protections CB-120/CB-123 contre
  refresh, tags tardifs, raccourcis globaux et composition IME sont conservées.

Pas de nouveau backdrop manuel, de body inert, de scroll lock ou de listener
installé à chaque ouverture. Les écouteurs communs sont installés une fois par
le module ES. Les formulaires Live/settings restent intégrés aux pages.

Diagnostic opt-in depuis la console de développement ou Playwright :
`(await import('/dialog-drafts.js')).dialogDiagnostics()` retourne le nombre de
dialogues ouverts/top-layer, un modal orphelin, la perte de focus et les sessions
fermées non nettoyées. Aucun champ, secret ou payload n’est journalisé.

## Validation

Environnement : `PLAYWRIGHT_BROWSERS_PATH=/var/lib/codexbridge/.npm/playwright`,
`TMPDIR=/var/lib/codexbridge/.npm/test-tmp`.

- `node --test tests/desktop-interaction-manager.node.test.mjs` : vert. **20 cycles
  Planning et 20 cycles Soundboard**, vrais clics/saisie/select/Tab/Escape,
  sauvegarde/réouverture, PUT settings déclenchant un refresh WebSocket pendant
  l’édition, identité DOM/focus/caret, échec puis retry, double-clic avec exactement
  une requête par cycle, exclusion des modales, restauration des clics et teardown
  idempotent suivi d’un Escape. Soundboard est simulée sans périphérique audio ;
  les créations Planning et les rafraîchissements passent par le vrai serveur.
- Régressions CB-120 : drafts, completions, creation, planning-editor et bulk-delete
  passent dans la suite Node. Live drafts, connexions et tags CB-123 sont également
  rejoués dans la suite complète.
- `npm test` : 1032 tests Vitest et 165 tests Node/Chromium verts.
- `npm run test:browser` : 15 tests verts.
- `npm run build` et `npm run check:shipped-js` : verts (32 fichiers JS).
- `git diff --check` : vert.

Le premier stress utilisait à tort GET settings (route inexistante) : corrigé en
PUT settings réel. Le test fragment CB-118 a été adapté aux deux nouveaux appels
communs ; sa logique tags reste inchangée. Les suites ont ensuite été relancées.
Electron natif n’a pas été exécuté : binaire Electron non installé et absence de
DISPLAY/Xvfb dans cet environnement. Les résultats ci-dessus sont ceux de
Chromium headless, pas une validation du focus natif Windows ni d’un IME Windows.

## Revue 1 — lecture OBS dépassée par la configuration

Sur `5b8e338`, la lecture GET lancée à l’ouverture et le POST de configuration
capturaient la même révision du dialogue. Sans saisie ni fermeture, leurs deux
complétions restaient valides : un GET ancien pouvait réafficher « Configuration
requise » après le succès « Prêt » du POST. Le nouveau test Chromium reproduit
ce retour arrière avant correction.

Après acquisition du verrou de mutation, le submit OBS appelle désormais
`changeDialogDraft(dialog)` puis capture sa propre complétion. Cela invalide la
lecture précédente avec le mécanisme commun existant. Un double submit refusé
par le verrou ne change pas la révision de l’opération en cours. Les fermetures
et réouvertures continuent d’invalider les complétions de l’ancienne session.

`tests/desktop-obs-dialog-ordering.node.test.mjs` utilise le vrai serveur et les
boutons Desktop dans Chromium ; les endpoints OBS sont interceptés pour contrôler
l’ordre des réponses sans matériel OBS. Ses trois scénarios couvrent :

- ouverture → configuration immédiate réussie → libération du GET ancien ;
- fermeture/réouverture pendant le GET, puis succès et libération des deux GET ;
- fermeture/réouverture pendant le POST, ancienne réponse pendant la nouvelle
  configuration, double-clic (verrou toujours actif), puis succès et GET tardifs.

Les assertions vérifient le statut visible et l’état canonique du renderer,
le nombre de mutations, la fermeture finale et les clics après fermeture.
Avant correction : 3 échecs (« Configuration requise » au lieu de « Prêt »).
Après correction : 3/3 verts.

Validation finale de la revue :
`node --test tests/desktop-obs-dialog-ordering.node.test.mjs` (3/3),
`npm test` (1032 Vitest + 168 Node/Chromium, dont les 40 cycles de stress),
`npm run test:browser` (15/15), `npm run build`,
`npm run check:shipped-js` (32 fichiers) et `git diff --check` verts.
Même environnement Chromium headless que ci-dessus ; aucun test Electron natif
supplémentaire ni connexion à un OBS réel.
