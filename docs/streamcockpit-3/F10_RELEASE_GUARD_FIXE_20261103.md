# F10 — Contrôle de release spécifique StreamCockpit 3.0 (FIXE, 2026-11-03)

## Problème vérifié
- La commande historique `npm run universal:status` et la précédente chaîne `release:check` appelaient `check-universal-release.mjs`, destiné à Next 2.1 : il exige `docs/qa/next21-qualification.json` (absent de ce worktree) et un inventaire avec YouTube incompatible avec la 3.0 Twitch-only. Ne PAS fabriquer ce fichier ni qualifier l'ancien check comme une preuve 3.0.
- Source réelle de qualification : `docs/streamcockpit-3/feature-matrix.json`, six gates G0–G5 et onze fonctionnalités F00–F10.

## Code et comportement
- Nouveau `scripts/streamcockpit3-readiness.mjs` : lecteur **strictement en lecture seule** de la matrice 3.0. Il vérifie l'identité/version du schéma, l'ensemble exact des 11 fonctions et six gates sans doublons, leurs statuts et la présence déclarée des preuves logicielles/matérielles.
- `npm run streamcockpit3:status` : affiche un bilan honnête et les blocages, sans construire de package. Le mode `--json` est prévu pour les outils QA.
- `npm run streamcockpit3:release-check` : **échoue intentionnellement** tant que le vérificateur indépendant des deux artefacts n'existe pas. Une matrice modifiée à tort pour marquer tous les éléments « qualified » ne suffit jamais. Le vérificateur de signature Authenticode Windows, signature Android production, SHA-256 de chacun, même commit source et migration/rollback matériel reste à développer et à qualifier.
- `release:check` commence maintenant **par ce contrôle spécifique 3.0** et ne lance aucune étape `desktop:prepare`, build ou packaging quand il refuse. Les commandes brutes `desktop:make` / `android:build` restent des outils de build non qualifiés, PAS des procédures de publication approuvées. L'ancien `universal:status` reste inchangé à titre historique.

## Preuves sur FIXE
- Préflight effectué via Remote Desktop Commander uniquement sur FIXE Windows 11, canonique propre au départ `08e1329`, Q isolé `4400e93`. Aucun autre job StreamCockpit ni contact avec les installations, les autres machines ou OBS/Twitch réels.
- Six nouveaux scénarios `tests/streamcockpit3-readiness.test.ts` : matrice réelle, corpus incomplet/dupliqué, faux statuts qualifiés, preuves hardware manquantes, CLI `--final` avec exit 1, ordre du garde `release:check`. Les 3 tests roadmap et 29 tests d'intégration updater associés donnent **38/38 PASS / 0 skipped / 0 fail** sur 4 fichiers.
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `npm run security:check` PASS (**873 fichiers**) ; `git diff --check` PASS.
- `npm run streamcockpit3:status` : **2/6 gates déclarés qualified, 0/11 fonctionnalités qualified**, retour status lisible.
- `npm run streamcockpit3:release-check` et `npm run release:check` : **refus attendu, exit 1**, message `STREAMCOCKPIT3_RELEASE_NOT_QUALIFIED`, aucune préparation de distribution exécutée.
- Pas de suite Vitest générale/Node, de build de développement, d'installeur, d'APK ni de signature effectués pour ce lot. Les tests précédents ne sont pas attribués à cette révision.

## Gates
**F10 reste partial ; G0/G1 qualified historiquement, G2 in_progress, G3–G5 open.** Il manque notamment le vérificateur cryptographique des artefacts Windows/Android même commit, les preuves de migration/rollback et les essais physiques. Ce garde fournit une barrière de qualification logicielle, **pas** la qualification G4 ou une RC.
