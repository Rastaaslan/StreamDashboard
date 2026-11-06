# SC3-AUDIT — Actualisation FIXE en lecture seule dans Paramètres

**Date :** 2026-11-06 ; **périmètre :** FIXE, branche `streamcockpit/3.0-full-experience` ; un seul petit lot UI. Aucune release ni installation.

## Constats / préflight

- Autorités lues : `PLAN.md`, `feature-matrix.json` (11 fonctions, F00/F05/F10 `partial`, gates G0/G1 `qualified`, G2 `in_progress`, G3–G5 `open`), `CONTINUITY.md`, `MIGRATION_TO_FIXE_20261101.md`.
- Source au démarrage `a5ec455`, remote `Rastaaslan/StreamDashboard`, pas de lock Git, aucun Node/npm/git écrivain du dépôt détecté. OBS/EXE utilisateur uniquement inventoriés au niveau processus, aucune interaction avec eux ; charge faible. Les cinq modifications F05 + `CONTINUITY.md` préexistantes appartiennent à un autre chantier : ne pas les écrire, indexer, stasher ou publier.
- Avant le lot, le bouton ajouté à `Paramètres → Connexions` appelait `refresh(true)` via `data-task="refresh-live"` ; `refresh()` invoque `autonomy.sync()`, susceptible d'envoyer des changements locaux en attente via POST `/api/v2/autonomy/sync`. Un simple clic d'actualisation pouvait donc transmettre des modifications que l'utilisateur n'avait pas l'intention de publier à ce moment-là.

## Correction étroite

- Le bouton est maintenant **« Actualiser l’état de FIXE (lecture seule) »** avec une action dédiée `refresh-host-readonly` (aucune réinitialisation OAuth).
- Nouvelle fonction pure `observeHostReadOnly` : **un seul GET** `/api/v2/autonomy`, vérifie l'identité de l'espace, la forme et la fraîcheur de l'état, refuse un retour tardif après changement de régie. Elle n'appelle pas la synchronisation ni `/api/v2/autonomy/sync`.
- Dans `control.js`, le résultat conforme est accepté uniquement dans **la copie IndexedDB locale** via `store.accept`, sans vider ni transmettre l'outbox. Rafraîchissement des états UX uniquement si l'identité sélectionnée est toujours la même. En cas d'erreur ou de réponse périmée : état non vérifiable, garde des commandes dépendant de FIXE désactivée. Une synchronisation déjà en cours bloque ce clic plutôt que de s'y joindre.
- L'actualisation automatique générale du produit reste inchangée et **peut toujours synchroniser des éditions en attente ultérieurement**. Ce lot garantit la lecture seule pour l'**action explicite**, pas un arrêt global des synchronisations ni une lecture seule du cache local.

## Preuves de qualification

- Premier run RED de la nouvelle suite : **1 suite FAIL / 0 tests exécutés** (module absent, import non résolu) ; ce n'est pas une régression fonctionnelle démontrée, mais une garde de compilation préalable. Le chemin précédent `refresh-live` a été vérifié en code.
- Première passe après intégration du nouveau chemin : **17 PASS / 2 FAIL** sur 19 ; deux assertions de l'ancienne suite attendaient encore `refresh-live`. Assertions modifiées pour exiger le parcours dédié, sans retirer de vérification de sécurité.
- Qualification finale `SC3_AUDIT_BROWSER_TEST=1 SC3_SETTINGS_BROWSER_TEST=1` : **19 PASS / 0 FAIL / 0 skipped** (2 fichiers), dont **6 scénarios réels Edge** en largeur mobile 320 px ; aucun réseau public.
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `node --check` des trois modules JS PASS ; `npm run security:check` PASS (**6 783 fichiers**, y compris autres modifications non attribuables à ce lot) ; `git diff --check` PASS (avertissements LF/CRLF non bloquants).

## Limites et suite

- Pas de véritable clic sur une application QA installée, d'essai WebView Android, d'interruption réseau physique ni de fournisseur OBS/Twitch connecté. Les tests du chemin de GET utilisent des réponses simulées et le navigateur teste le rendu/les contrôles, pas le transport utilisateur réel.
- Prochaine amélioration : distinguer clairement les éditions locales en attente et la synchronisation automatique normale, puis vérifier sur trois appareils avec réception opérateur. Aucun secret, profil utilisateur, signature Android, package, installation, Live ou configuration OBS/Twitch modifiés.
- **F00 partial ; G2 in_progress ; G3–G5 open.** Aucun statut de gate promu par ce lot.
