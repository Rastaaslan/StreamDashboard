# StreamCockpit 3.0 — Audit Settings : actions d'association dupliquées

**Lot audit 02, 6 novembre 2026, 01 h 48–01 h 54 CET.** Pas une livraison, aucun appareil installé ou commandé.

## Préflight et limites

- Exécution exclusivement via Remote Desktop Commander sur FIXE Windows 11 ; lecture de `PLAN.md`, `feature-matrix.json`, `CONTINUITY.md` et `MIGRATION_TO_FIXE_20261101.md` avant toute édition.
- HEAD initial `e2d7591` sur `streamcockpit/3.0-full-experience`, origine `https://github.com/Rastaaslan/StreamDashboard.git` ; Git aligné sur origin, aucun lock/rebase/merge. OBS et la QA `f15845b` détectés en processus, jamais sollicités. CPU ponctuel 22 %. Cinq modifications F05/CONTINUITY préexistantes et en cours : **préservées et jamais indexées**.
- La passe séparée sur le mot de passe OBS est déjà au HEAD `e2d7591` : elle n'est pas réimplémentée dans ce lot.
- Interventions limitées à `apps/mobile/control/settings-simplified.js`, `tests/streamcockpit3-audit-paired-devices.test.ts` et le présent rapport. Aucun secret, configuration utilisateur, OBS/Twitch public, profil, RC2, migration, EXE/APK, agent réseau ni modification matérielle.

## Défaut reproduit et correction

La page **Appareils & Deck** montrait simultanément sur **FIXE** deux boutons `Créer un code d'association` (carte Android et rubrique avancée), plus le bouton contradictoire `Associer une régie` ; sur **laptop client**, elle montrait deux fois `Associer FIXE` / `Associer une régie`. Ces doublons favorisent des associations inutiles et brouillent la distinction entre maître et client, sans bénéfice fonctionnel.

- Test RED avant correction : **5 PASS / 2 FAIL / 2 skipped** dans la suite ajoutée. Échecs attendus précisément sur 2 pairings FIXE et 2 connexions laptop ; les 2 scénarios Edge étaient désactivés pour isoler la régression.
- Correction : **FIXE** conserve un bouton de génération de code sur la carte Android, et un accès distinct en lecture seule aux associations ; aucun appel `Associer une régie`. **Laptop** conserve un seul `Associer FIXE` sur sa carte client ; aucun `pairing` local. **Android** conserve son entrée de connexion à FIXE. Le mode Android avec exécuteur local explicite conserve son bouton avancé `Créer un code d'association` et ses permissions/transport ; les outils de permissions/transport FIXE ne sont pas perdus.
- Les `data-task` existantes sont réutilisées ; seules les conditions d'affichage ont changé. Aucune requête réseau déclenchée par le rendu.

## Qualification sur la source corrigée

- `npx vitest run tests/streamcockpit3-audit-paired-devices.test.ts tests/streamcockpit3-settings-topology-browser.test.ts tests/streamcockpit3-desktop-settings-role.test.ts --maxWorkers=2`, avec `SC3_AUDIT_BROWSER_TEST=1` et `SC3_SETTINGS_BROWSER_TEST=1` : **21 PASS / 0 FAIL / 0 skipped**, 3 suites. Dont **4 tests lançant réellement Microsoft Edge headless** ; nouveau test sur les profils FIXE / laptop / Android à 320 px, sans requête réseau.
- `npm run build:types` : PASS ; `npm run check:browser-types` : PASS ; `node --check apps/mobile/control/settings-simplified.js` : PASS ; `npm run security:check` : PASS (**6 765 fichiers** sur l'arbre avec changements F05 concurrents), `git diff --check` : PASS avec avertissements LF/CRLF seulement.
- Pas de suite exhaustive sous charge, de test Android physique, de preuve de connexion réelle, de package ni de déploiement. Les tests browser isolent le rendu avec HTML synthétique.

## Suivi restant

Étudier ensuite le comportement des statuts **vraiment en ligne** (présence WebSocket vs dernier contact sans sur-promesse) ou l'éligibilité sûre des contrôles « prêt à diffuser » dans le dashboard classique. Ne pas refactoriser tout le contrôleur ni toucher au mixeur F05 sans transfert explicite d'ownership. **G0/G1 qualifiés historiquement ; G2 in_progress ; G3–G5 open.**
