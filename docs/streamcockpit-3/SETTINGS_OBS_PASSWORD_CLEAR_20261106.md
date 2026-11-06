# SC3 — Settings OBS : effacement explicite du secret de la régie (06/11/2026)

## Problème et propriétaire

Le backend FIXE possède déjà la mutation explicite `clearObsPassword` (`apps/server/src/index.ts`, route `PUT /api/v2/settings`, contrôle `expectedRevision`, secrets Windows, puis reconfiguration OBS). L'interface partagée Desktop/Android ne proposait que de saisir un nouveau mot de passe, avec **champ vide = conserver**. Impossible d'effacer proprement un ancien secret par ce parcours sans risquer une ambiguïté de saisie. Cette passe est limitée au formulaire OBS de FIXE, sans toucher au backend, aux profils ni aux secrets réels.

**Cartographie des paramètres du parcours :** `obsUrl`, `obsPassword` et `clearObsPassword` appartiennent à la régie **FIXE**, service `/api/v2/settings`. Le client/laptop/Android peut consulter certains réglages après association mais n'acquiert jamais le droit UI d'effacer le secret. Les autres champs (micro/scènes/minuteur et activation LAN) ne changent pas de propriétaire et ne sont pas migrés. Les comptes Twitch et Google ne sont pas liés au mot de passe OBS.

## Correctif concret

- `apps/mobile/control/settings-view.js` : option **décochée** « Effacer le mot de passe OBS enregistré sur FIXE » uniquement quand FIXE Desktop maître est joignable sur son propre endpoint, le serveur indique un secret présent, et l'interface n'est pas Android. Message explicite sur la reconnexion OBS sans mot de passe. Aucun champ secret prérempli.
- `apps/mobile/control/obs-password-change.js` : fonction pure de création du patch. Champ vide seul donne `{}` et conserve le secret ; nouveau mot de passe seul donne `{obsPassword}` ; effacement interdit sans rôle autorisé, sans confirmation affirmative ou si nouveau secret simultanément saisi. Les annulations ne déclenchent **aucune requête**.
- `apps/mobile/control/control.js` : intègre l'étape de confirmation **avant** `PUT /api/v2/settings` ; le backend existant applique les contrôles d'accès et la protection contre révision périmée. Le module ne touche pas les commandes de diffusion ni les identités OBS/Twitch.
- `tests/streamcockpit3-settings-obs-password.test.ts` : tests des modes conserver/remplacer/effacer, refus des conflits, refus d'un client/Android/FIXE hors ligne, et rendu Microsoft Edge réel 320/1366px avec réseau intercepté (aucune requête).

## Preuves sur FIXE, sans installation

- Préflight avant intervention : `PLAN.md`, `feature-matrix.json`, `CONTINUITY.md`, `MIGRATION_TO_FIXE_20261101.md` lus ; branche `streamcockpit/3.0-full-experience`, remote `https://github.com/Rastaaslan/StreamDashboard.git`, HEAD initial `2c67548` égal à origin, aucun git index.lock. OBS observé connecté et **hors diffusion** ; aucune commande OBS ni Twitch émise.
- Arbre déjà sale par **cinq fichiers F05/CONTINUITY d'un autre propriétaire** : `apps/mobile/control/streamcockpit-mixer-{control,page}.js`, `apps/mobile/control/streamcockpit-mixer.js`, `tests/streamcockpit3-mixer-browser.test.ts`, `docs/streamcockpit-3/CONTINUITY.md`. Aucun de ces fichiers n'est modifié ni indexé par ce lot ; la continuité est documentée ici plutôt que de provoquer un conflit.
- Qualification finale du code de ce lot : **3 suites ciblées : 20 PASS / 0 FAIL / 1 skipped** (`SC3_SETTINGS_PASSWORD_EDGE=1`, `SC3_SETTINGS_BROWSER_TEST=1`), dont **trois tests Edge réels** ; le skip est le contrôle navigateur d'une ancienne suite `audit-paired-devices` dont le drapeau indépendant n'était pas activé. `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `node --check` du module PASS ; `npm run security:check` PASS (**6 765 fichiers**) ; `git diff --check` PASS (avertissements de fin de ligne CRLF non bloquants). Aucune suite générale ou build de distribution.
- Tous les scénarios Web/Edge sont effectués sur des fixtures synthétiques. **Aucun secret réel effacé**, aucun OBS reconnecté, aucune diffusion/publication, aucun changement de profil utilisateur ou d'installation Windows/Android/laptop, aucune signature ou RC.

## Limites et suite

- Ne pas assimiler tests de formulaire à une modification réelle d'un secret OBS : cette action nécessite un opérateur et doit être qualifiée dans G3 quand un nouveau package sera explicitement autorisé.
- La route serveur existante accepte encore les clés `obsPassword` et `clearObsPassword` ensemble en donnant priorité à l'effacement ; l'UI de cette passe refuse ce mélange, mais un durcissement serveur de cette ambiguïté mérite un lot de sécurité séparé avec tests API, sans changer les installations.
- Inspecter ensuite les parcours avancés et les doublons de Settings avant toute suppression de code. Garder `F00` partiel, `G2` en cours, `G3`/`G4`/`G5` ouverts : **aucune preuve de réception matérielle, production Android signée ni rollback qualifié**.
