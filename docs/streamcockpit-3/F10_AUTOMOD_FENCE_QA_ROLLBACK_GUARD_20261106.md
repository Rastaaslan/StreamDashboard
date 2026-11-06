# F10 / F02 — sauvegarde et restauration sans régression du journal anti-rejeu (06/11/2026)

## Périmètre et préflight
- Remote Desktop Commander **FIXE Windows 11 uniquement**, dépôt canonique, HEAD de départ `34acba0`, branche `streamcockpit/3.0-full-experience`, origin `https://github.com/Rastaaslan/StreamDashboard.git` synchronisé (0 avance / 0 retard) ; aucun lock Git / merge / rebase constaté.
- `PLAN.md`, `feature-matrix.json`, `CONTINUITY.md`, `MIGRATION_TO_FIXE_20261101.md` et audit final G2 lus avant mutation.
- Cinq fichiers F05 / `CONTINUITY.md` déjà modifiés par une autre mission : **aucun accès en écriture, aucun stage et aucun commit de ces fichiers**.
- OBS et StreamDashboard utilisateur uniquement observés comme processus ; aucune installation, profil réel, secret, commande OBS/Twitch ou autre machine/projet touchés.
- Test exclusivement dans des répertoires `sc3-upgrade-qa-*` créés sous le dossier temporaire de Windows. Code de QA F10 uniquement, pas d'adaptateur de production.

## Défaut reproduit
Le parcours F10 savait restaurer un SQLite depuis une sauvegarde intègre, mais ignorait une **nouvelle tentative AutoMod F02 écrite après cette sauvegarde**. Restaurer un ancien `streamcockpit-automod-action-intents.sqlite` pouvait donc perdre l'interdiction durable de renvoyer une décision Twitch déjà tentée. La sauvegarde pouvait également omettre ce fichier avant une première réservation ultérieure.
- RED : **10 PASS / 2 FAIL / 0 skipped**, sur `streamcockpit3-upgrade-qa-checkpoint.test.ts`. Les deux échecs reproduisent explicitement le rollback périmé et l'absence du journal dans une ancienne sauvegarde.

## Correction intégrée en source
- Le pipeline QA compare l'existence, la taille et le SHA-256 du journal **réel SQLite F02 dans `active`** avec son entrée du manifeste de sauvegarde.
- Absence d'un seul côté, contenu modifié, fichier non régulier, lien, hardlink ou données illisibles : `QA_CHECKPOINT_AUTOMOD_FENCE_CHANGED`, sans publication de `migrated` / `restored`.
- Contrôle une fois après vérification de la sauvegarde, puis une deuxième fois **juste avant la promotion** de la copie migrée/restaurée. Toute copie temporaire en échec est supprimée ; sauvegarde et `active` restent intacts.
- Test avec véritable `AutoModActionIntentSqlite`, réservations `ALLOW`/`DENY` et vérification d'anti-rejeu avant/après copie, migration et restauration. Un nouveau COMMIT au milieu de la migration est détecté et la sortie refusée.
- Aucun ajout de route/commande Twitch ni migration automatique ; `node:sqlite` reste expérimental sur Node 22.

## Qualification du lot
- 7 suites ciblées F10/F02/migration/roadmap : **90 PASS / 0 FAIL / 0 skipped** (Windows temporaire, vrais fichiers SQLite, autres interfaces simulées). Log : `%TEMP%\\sc3-f10-automod-final-20261106.log`.
- `npm run build:types` : PASS (premier essai : 2 erreurs TS de raffinement de type dans le nouveau garde, corrigées avant revalidation).
- `npm run check:browser-types` : PASS ; pas de nouveau test Microsoft Edge (aucun parcours UI modifié).
- `npm run security:check` : PASS (**6 786 fichiers** avant le présent rapport).
- `git diff --check` : PASS ; seuls avertissements de conversion CRLF.
- Aucune suite générale ni package EXE/APK ; les tests ne qualifient ni Twitch de production ni les installations réelles.

## Limites et prochaines étapes
Ce contrôle QA **n'est pas atomique** avec un processus F02 continuant à écrire après la seconde lecture. Un protocole de quiescence/verrou exclusif, un verrou de non-régression externe aux données restaurées et des tests de mise à jour transactionnelle sont nécessaires avant un rollback en production. Une absence du fichier des deux côtés signifie seulement « aucun journal F02 présent dans cette copie isolée » et n'est pas une preuve d'absence historique de tentatives.
**F02/F10 restent `partial` ; G2 `in_progress`, G3/G4/G5 `open`**. Prochaine action prioritaire : protocole de migration/repli de production qui conserve les barrières F02/F08/F09 et qualifie les signatures/artefacts de même commit et le trio matériel, sans toucher aux installations avant autorisation.
