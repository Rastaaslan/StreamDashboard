# F10 — Intégration QA : sauvegarde, migration versionnée, restauration (06/11/2026)

## Préflight et périmètre
- Intervention exclusivement via Remote Desktop Commander sur **FIXE Windows 11** dans le dépôt canonique `streamcockpit/3.0-full-experience`, base HEAD `84de984`, remote officiel vérifié et synchronisé, sans index.lock/merge/rebase.
- Sources d'autorité `PLAN.md`, `feature-matrix.json`, `CONTINUITY.md`, `MIGRATION_TO_FIXE_20261101.md`, audit final lus avant mutation.
- Les quatre fichiers F05 du mixeur et le `CONTINUITY.md` modifiés par un propriétaire distinct n'ont pas été touchés, indexés ni remplacés. OBS/StreamDashboard observés comme processus actifs uniquement : aucun contrôle, installation, live, commande Twitch ni secret utilisateur lu.
- **Pas d'adaptateur d'installation de production** : uniquement un laboratoire Windows dans un dossier créé sous `%TEMP%\sc3-upgrade-qa-*`, sans accès à un profil installé.

## Blocage reproductible (RED)
Le moteur de migration F10 protégeait `associations` et `profiles`, mais acceptait la suppression ou le remplacement silencieux d'autres champs du profil (incluant des données d'un module inconnu). Régression isolée : **1 FAIL / 1 PASS / 28 skipped** avant correction, défaut reproduit.

## Lot fonctionnel réalisé
1. `migrateUpgradeData` exige désormais la préservation de **tous les champs préexistants** entre versions, hormis `schemaVersion`. Une transformation volontaire d'un champ existant exige `mutableKeys` explicitement déclaré sur l'étape et ne peut jamais supprimer une clé ni contourner les contrôles d'associations/profils. Ajouts de clés permis, snapshot d'origine toujours détaché.
2. Le pipeline QA F10 fournit `migrateQaProfileCopy` : **sauvegarde complète hashée**, revalidation de l'inventaire et SHA-256, copie binaire privée vers un dossier `migrated-pending-*`, migration JSON **seulement sur une copie**, `fsync` du résultat, relecture et vérification que tous les autres octets sont inchangés, puis promotion de la copie vers `migrated`. Au moindre échec, suppression uniquement du dossier temporaire créé par ce test.
3. Le contrôle commun de sauvegarde intègre `restoreQaProfile` : une **restauration distincte** dans `restored` est réalisable et vérifiée même après une migration échouée. Les répertoires `active` et `backup` restent intacts. Une seconde migration refuse de remplacer `migrated`.

## Preuves
- Trois suites ciblées F10 après correction : **64 PASS / 0 FAIL / 0 skipped**.
- Campagne élargie F10 / updater / recovery / roadmap (9 fichiers) : **98 PASS / 0 FAIL / 0 skipped**.
- `npm run build:types` PASS, `npm run check:browser-types` PASS.
- `npm run security:check` PASS (**6 778 fichiers** avant ce rapport).
- `git diff --check` PASS (avertissements LF/CRLF uniquement).
- Scénarios réellement exercés sur le système de fichiers **Windows temporaire** : copie de paramètres binaires, journal SQLite factice, données assimilées à credentials synthétiques, champs inconnus, corruption, refus de remplacement et restauration indépendante.

## Limites et prochain obstacle
Aucune migration automatique des profils utilisateurs, transaction Squirrel/Agent/Android, validation d'une release signée, garantie lors d'une panne secteur ou rollback d'une installation Windows réelle. F10 demeure **partial**, G2 **in_progress**, G3/G4/G5 **open**. Le prochain chantier de convergence est l'adaptateur transactionnel de production avec identité et sauvegarde vérifiées, sans autoriser `quitAndInstall` ni aucune installation tant que les signatures et la réception G3/G4 manquent. ClipForge V4 et personnalisation V3.1 restent exclus.
