# G4 — Inventaire strict d'une sauvegarde antérieure à migration (FIXE, 05/11/2026)

## Préflight et propriété
- RDC **FIXE Windows 11 uniquement** ; quatre sources de vérité PLAN, feature-matrix, CONTINUITY, MIGRATION lues intégralement avant action.
- Branche `streamcockpit/3.0-full-experience` ; HEAD initial `1d5d48b764be3d7116e276592de1b5480c01172a`, origin GitHub attendu, HEAD égal upstream, aucun index.lock, merge ou rebase.
- Fichiers F05 `streamcockpit-mixer-{control,page}.js`, `streamcockpit-mixer.js`, `tests/streamcockpit3-mixer-browser.test.ts` et `CONTINUITY.md` déjà modifiés par un autre propriétaire : non modifiés, non indexés, non restaurés. Aucun éditeur/compilateur StreamCockpit concurrent repéré ; Node de Remote Desktop Commander et codex serveur observés seulement. Pas d'action OBS/Twitch, de RC, de publication, d'installation utilisateur ou de modification d'autres projets/appareils.

## Régression et correction
- **Défaut réel du code** : `ensureRc117Backup()` relisait les fichiers mentionnés dans un `manifest.json` existant mais ne comparait jamais cette liste avec l'inventaire réel du répertoire sauvegardé. Un manifeste amputé (jusqu'à omission d'une référence `secure/credentials.dat`), des fichiers ajoutés non référencés ou une ligne dupliquée pouvaient être acceptés comme sauvegarde intégrale avant migration.
- **RED corrigé côté harnais puis reproduit** : **3 PASS / 3 FAIL / 0 skipped** (`.git/sc3-f10-inventory-red-final-20261105.log`). Une première tentative avait en plus une erreur de fixture de test (écriture dans un sous-répertoire inexistant), corrigée avant la campagne RED retenue.
- **Correctif minimal** dans `apps/desktop/src/migration-backup.ts` : validation stricte des champs de manifeste (chemins relatifs, tailles et SHA-256), recensement de tous les fichiers présents et refus si l'ensemble diffère, y compris doublons de noms avec casse différente sous Windows. Vérification de contenu SHA-256 déjà existante conservée. L'échec intervient avant toute écriture de `installation-v2.json` ; aucune purge ni réparation automatique du backup.
- **Régressions** dans `tests/migration-backup.test.ts` : entrée manquante, fichier orphelin, doublon exact, doublon insensible à la casse avec refus de création du fichier d'installation. Tous les profils du test sont **synthétiques dans OS Temp** ; aucune donnée ou sauvegarde d'utilisateur ouverte.

## Qualification de la source modifiée
- Quatre suites Vitest ciblées (**67 PASS / 0 FAIL / 0 skipped**) : migration-backup (7), upgrade-qa-checkpoint (6), upgrade-integration (25), upgrade (29). Journal `.git/sc3-f10-inventory-final-20261105.log`.
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `npm run security:check` PASS (**6 750 fichiers**, y compris état F05 non commité d'autrui) ; `git diff --check` PASS. Journaux `.git/sc3-f10-inventory-{types-final,browser-final,security-final,diff-final}-20261105.log`.
- Pas de campagne générale, de build EXE/APK, de signature production, de migration de profil réel, de coupure secteur ni de test sur Android/laptop. Les validations sont des tests logiciels de sauvegarde pré-migration et **ne qualifient pas G4**.

## État / suite
- F10 `partial`, G2 `in_progress`, G3/G4/G5 `open` ; G0/G1 historiquement qualifiés, sans changement.
- `CONTINUITY.md` est sous modification F05 externe : la preuve est écrite ici plutôt que de chevaucher son propriétaire. Reporter ce lien au journal canonique seulement après libération du fichier.
- Prochain objectif réellement utile : réception physique G3 de la QA même commit et qualification G4 de signatures stables compatibles, migration et rollback sur installation de test, sous autorisation opérateur distincte.
