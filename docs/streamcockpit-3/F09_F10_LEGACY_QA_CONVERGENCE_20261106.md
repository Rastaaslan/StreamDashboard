# F09/F10 — Migration héritée intégrée au parcours QA transactionnel

**Date :** 06/11/2026 — **machine unique :** FIXE Windows 11 — **lot :** sources + régressions, sans installation.

## Constat, décision et périmètre
- Préflight avant écriture : `PLAN.md`, `feature-matrix.json`, `CONTINUITY.md`, `MIGRATION_TO_FIXE_20261101.md`, `FINAL_DELIVERY_AUDIT_20261103.md` lus. HEAD initial `150fe42`, branch `streamcockpit/3.0-full-experience`, origin GitHub conforme et synchronisé ; aucun index.lock/rebase/merge/flow-owner. OBS et StreamDashboard en cours **non manipulés**. Pas d'accès aux autres appareils, profils, secrets, F09-Q ni RC2.
- Les fichiers F05/mixeur, son test, `CONTINUITY.md` et le handoff audit non suivi appartiennent à d'autres travaux : **aucun changement ni staging**. Aucun test de fournisseur, live, installation, signature ou publication.
- F09 disposait **déjà** de `migrateLegacyMomentsToSqlite` avec verrou d'écrivain, archive conservée, validateur canonique et transaction SQLite Windows. Le blocage restant était que le parcours F10 `checkpointQaProfile → migrateQaProfileCopy → restoreQaProfile` ne savait migrer **sur copie** que les settings, et laissait l'ancien journal JSON dans le répertoire `migrated` ; le runtime SQLite continuait à refuser ce dossier avec `MOMENTS_LEGACY_MIGRATION_REQUIRED`.

## Fonctionnel intégré
- `migrateQaProfileCopy(..., {migrateLegacyMoments:true})` : **option explicite**, jamais automatique. Le strict scénario `sc3-upgrade-qa-*` dans le répertoire temporaire Windows est imposé par la procédure de checkpoint existante ; un appel standard, sans option, conserve l'ancien comportement.
- Le registre F09 JSON actif est comparé à l'inventaire de la sauvegarde (taille, SHA-256, inode, date de modification, lien, présence de lock/journal/SQLite/archive concurrent), avant et après la migration. Une variation refuse la promotion. Ceci **détecte** les producteurs non coordonnés, sans constituer une exclusion multi-processus de production.
- Dans une copie `migrated-pending-*` vérifiée : **réutilisation** du convertisseur F09 existant (validation du JSON checksummé canonique, verrou, transaction SQLite DELETE/EXTRA, relecture intégrale/integrity check et archive `streamcockpit-moments.json.pre-sqlite.json`). Aucune nouvelle implémentation concurrente du format ou deuxième régie.
- Contrôle inventaire F10 adapté uniquement aux deux transformations autorisées : `settings.json` explicitement migré et F09 `JSON → SQLite + archive`. L'ancien JSON est absent de `migrated`, les moments exacts restent consultables par `MomentsPipeline` après réouverture SQLite. **Backup**, **active** et **restored** conservent les octets originaux, notamment les barrières permanentes F02/F08 et les identifiants/statuts F09. Le retour arrière QA restaure l'ancien JSON de la copie d'origine, et non un faux journal neuf.
- `runQuiescedQaUpgrade` transmet cette option au parcours complet sous le garde coopératif F02/F08/F09 du précédent lot. Une entrée/transaction incertaine ne déclenche aucune répétition d'action fournisseur ni déverrouillage silencieux.
- Les cas invalides (schéma, checksum, clé JSON dupliquée, espace non canonique, identifiant corrélé dupliqué, texte contenant un secret, collision SQLite/archive, disparition ou mutation concurrente source, lock/journal, relance) échouent sans destination `migrated` partielle.

## Preuves sur FIXE
- D'abord **RED** : nouvelle suite avant code avec **1 PASS / 8 FAIL / 0 skipped**, montrant le défaut de migration ignorée et de contrôles absents.
- Régressions finales **13 fichiers / 175 PASS / 0 FAIL / 6 skipped** (6 tests POSIX non applicables à Windows), incluant le convertisseur F09 canonique, les vrais adaptateurs SQLite Windows F02/F08/F09, le parcours QA F10, crash/reprise existants et la matrice. Log : `%TEMP%\sc3-f09-f10-legacy-qa-20261106-tests.log`.
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `npm run security:check` PASS (6 791 fichiers avant ce document) ; `git diff --check` PASS (seulement avertissements CRLF sur fichiers sales d'autres propriétaires). Aucune suite générale/build d'installation : OBS et d'autres chantiers coexistent sur FIXE.

## Limites et prochain obstacle
- **Aucune migration sur profil utilisateur** ; tout s'exécute dans des répertoires temporaires QA auto-nettoyés. La conversion JSON→SQLite sur copie **ne prouve pas** la sécurité d'une bascule du serveur/Agent en fonctionnement.
- Reste indispensable pour G2/F10 : exclusion **multi-processus** réelle des écrivains et producteurs OBS/Twitch, registre de transaction récupérable après crash, garde d'installation, migrations et rollback Agent/Desktop/Android. Puis G3 réception matérielle du trio, G4 signatures Windows/APK du même commit et tests de reprise, G5 acceptation opérateur.
- **Statuts inchangés :** F09/F10 `partial`, G2 `in_progress`, G3/G4/G5 `open`. ClipForge avancé demeure V4 ; aucun droit/publication supplémentaire acquis.
