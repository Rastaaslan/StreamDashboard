# SETTINGS-P04 — Fraîcheur des observations Discord / Streamlabs / WizeBot (FIXE, 05/11/2026)

## Préflight et propriété
- Remote Desktop Commander **FIXE uniquement**, device b5db7551-143d-410a-8b84-157070125122. PLAN, feature-matrix, CONTINUITY et MIGRATION lus avant modification.
- Base Git `ea8aaf18a919ff833449a0d0a7ff2a8af5a16fd1`, branche `streamcockpit/3.0-full-experience`, origin `https://github.com/Rastaaslan/StreamDashboard.git`, HEAD/upstream 0/0 ; aucun index.lock, merge/rebase ni verrou Flow.
- Quatre fichiers F05 et `CONTINUITY.md` étaient déjà modifiés par un autre propriétaire. Aucune édition ni mise en index de ces cinq fichiers. Processus OBS/QA et développement World Director seulement observés ; aucune interaction avec leurs profils, installations ou projets.
- `out/sc3-final-delivery/completion.json` : lotComplete=true, missionDelivered=false, publicationAuthorized=false ; interdit toute publication de RC.

## Problème reproduit et correctif étroit
- Un client pouvait rester `online=true` tout en affichant un snapshot d'intégrations FIXE ancien, mal horodaté ou futur comme « connecté » ; la présence réseau ne garantit pas la fraîcheur du dernier état hôte.
- Source réelle : `DashboardState.at` est émis par le `snapshot()` de la régie FIXE ; `controlHub.integrations` fournit le statut observé. Aucun appel fournisseur, connexion supplémentaire ni secret côté Android.
- L'affichage partagé `settings-view.js` refuse désormais les états d'intégration Discord / Streamlabs / WizeBot si `state.at` est absent/invalide, vieux de plus de 90 s ou en avance de plus de 15 s sur l'horloge locale. Il indique « État de FIXE périmé : observation non vérifiable » au lieu d'un faux connecté. Une connexion récente reste « dernier état de FIXE », **jamais preuve de droits OAuth**.
- Ce test de fraîcheur est uniquement une règle d'**affichage**, pas une seconde horloge de régie ni une condition de mutation OBS/Twitch. Une dérive de l'horloge du téléphone peut donner un état non vérifiable (échec sûr), sans réparation ni retry.

## Preuves de cette passe
- RED avant correction : Vitest intégrations **3 PASS / 1 FAIL / 1 skipped** ; `%TEMP%\sc3-settings-fresh-red-20261105.log`. L'assertion reproduit un snapshot périmé toujours affiché « connecté ».
- GREEN après correction : 3 suites ciblées, **11 PASS / 0 FAIL / 0 skipped**, dont **2 scénarios en Microsoft Edge réel** (états intégrations hors ligne/périmés à 320 px, valeurs OBS conservées) ; `%TEMP%\sc3-settings-fresh-green-20261105.log`.
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `npm run security:check` PASS (**6761 fichiers**, avant ce document) ; `git diff --check` PASS. Logs `%TEMP%\sc3-settings-fresh-{build-types,check-browser-types,security-check}-20261105.log`.
- Revue de diff ciblée : `apps/mobile/control/settings-view.js`, `tests/streamcockpit3-settings-integrations-scope.test.ts`, cette preuve et la matrice. Aucun build de distribution, aucune installation/signature/connexion à un vrai fournisseur.

## Limites et prochain lot
- Ces tests utilisent des snapshots simulés et un navigateur Edge local, **pas** le véritable Android WebView, les scopes fournisseur ou une nouvelle réception FIXE/laptop/Android. Les états Google/Twitch et les boutons de configuration restent à auditer séparément pour propriétaire, autorisation, fraîcheur et capacité réelle.
- G0/G1 qualifiés historiquement ; **F01 partial, G2 in_progress, G3/G4/G5 open**. ClipForge avancé V4 d'après PLAN ; aucune RC, commande OBS/Twitch publique, donnée utilisateur ou installation modifiée.
- `CONTINUITY.md` est conservé intact car modifié par le chantier F05 d'un autre propriétaire ; ce rapport dédié fournit la traçabilité sans écrasement.
