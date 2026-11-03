# StreamCockpit 3.0 — One-shot logiciel et limites G2–G5 (FIXE, 2026-11-03)

## Environnement et portée
- Machine FIXE Windows 11 uniquement, via Remote Desktop Commander ; branche canonique `streamcockpit/3.0-full-experience` au départ `f249cfc`, propre, distante `Rastaaslan/StreamDashboard` alignée. Branche F09-Q `4400e93` observée en lecture seule, non intégrée. Aucun autre job StreamCockpit actif avant action. Aucun accès aux autres machines, RC2, OBS ou Twitch réel ; pas de déploiement ni RC.
- Documents PLAN.md, feature-matrix.json, CONTINUITY.md et MIGRATION_TO_FIXE_20261101.md relus avant actions ; limites du contrat préservées.

## Correction de fiabilité mise en œuvre
- `tests/google-missing-target-retry.test.ts` remplace uniquement les requêtes de la fixture HTTP locale `127.0.0.1` utilisant `fetch` par `node:http.request`, réponse adaptée au contrat Response, timeout 5 s, erreur socket explicitement propagée. Les fournisseurs Google restent simulés, aucun changement de production. Les ports éphémères valides sont parfois interdits par la politique Fetch, d'où les échecs `bad port` historiques.
- Contrôle ciblé Replay+Google : **7/7 PASS, 0 skipped/FAIL** ; TypeScript, types navigateur et sécurité **871 fichiers** PASS.

## Qualification logicielle exécutée, sans prétention matérielle
- Vitest général séquentiel (OpenSSL Git en PATH uniquement pour le processus) : **2153 PASS, 97 skipped, 0 FAIL**, exit 0, **267 fichiers (252 PASS/15 skipped)** ; `%TEMP%\sc3-oneshot-vitest-20261103.log`. Les skipped restent non qualifiés.
- Build de développement `npm run build` : **PASS**, 134 ressources publiques et 15 JS runtime copiés ; `check:shipped-js` **PASS (141 fichiers JS)**, aucun installateur ni APK généré.
- Suite Node construite, séquentielle après build : **349 PASS / 6 skipped / 0 FAIL sur 355**, exit 0 ; `%TEMP%\sc3-oneshot-build-node-20261103.log`.
- Playwright réseau local : **35/35 PASS**, exit 0 ; `%TEMP%\sc3-oneshot-playwright-20261103.log`.
- Edge headless tactile 320 px opt-in (F06 brouillon assisté et F08 création/libération prédiction) : **12/12 PASS**, exit 0 ; `%TEMP%\sc3-oneshot-edge-20261103.log`. Fournisseurs simulés ; pas de téléphone physique.
- `npm run universal:status` (contrôle historique Next 2.1, NON critère de 3.0) échoue **ENOENT** sur `docs/qa/next21-qualification.json` absent. Ne pas créer de fausse matrice, ne pas déclarer G4. Son besoin de modules YouTube est de plus étranger au périmètre Twitch-only 3.0.

## Évaluation honnête des gates
- **G0, G1 = qualified** historiquement. **G2 = in_progress** : tous F00–F10 restent `partial` dans feature-matrix.json, notamment ClipForge Windows isolé en laboratoire, commandes de lock/resolve/cancel prédiction manquantes, F10 updater non livré.
- **G3 = open** : aucun test réel sur FIXE + laptop + téléphone Android en tant que trio, aucune preuve de commande OBS sur vrai matériel ni de réconciliation Twitch/OAuth réels. L'usage de FIXE en développement n'est PAS une qualification G3.
- **G4 = open** : pas de package Windows x64 et APK Android release signés issus du même commit, ni qualification de migration, sauvegarde, rollback, clé Android de production, durabilité NTFS sous coupure de courant.
- **G5 = open** : candidate unique non certifiable avant G2–G4 et validation opérateur. Ne pas installer, publier ni modifier les flux publics.
- **3.1** `SC31-LAYOUT-001` reste hors du périmètre de livraison 3.0.

## Prochaines étapes prioritaires
1. Terminer G2 par l'intégration sûre de ClipForge Windows (provenance, Job Object signé, permissions/API, fichiers OBS réels), les opérations Twitch restantes et les parcours Desktop/API/Android ; préserver la régie OBS et le minuteur FIXE uniques.
2. Préparer protocole de tests G3 avec accès/approbation matériels séparés ; ne pas les simuler ni tester en secret.
3. Construire et auditer les preuves G4 de signature Windows/Android du même commit, migrations et rollback sur environnement autorisé, puis seulement G5.

Ce rapport est un état de qualification, PAS une RC ni une preuve de disponibilité hardware.
