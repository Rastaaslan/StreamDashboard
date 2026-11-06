# F10 — Préservation des journaux F02 / F08 / F09 pendant migration et restauration QA

## Exécution et périmètre — 6 novembre 2026
- Via Remote Desktop Commander **FIXE Windows 11 exclusivement**. Préflight complet : PLAN, feature-matrix, CONTINUITY, MIGRATION_TO_FIXE lus ; branche canonique, origin GitHub et Git status/log vérifiés. HEAD initial `d5cc230`, synchronisé, aucun lock Git/merge/rebase détecté.
- OBS et StreamDashboard observés comme processus actifs mais **aucune commande**. Aucun accès à laptop, Android, dam-server, RC2, WorldPrep, Director, Crafty, profil utilisateur ou secret.
- Cinq fichiers F05 / CONTINUITY déjà modifiés par un autre chantier, préservés sans stage ni modification. Réutilisation de l'adaptateur QA F10 existant ; aucune commande de migration ni rollback sur une installation réelle.

## Défaut reproduit avant correction
L'adaptateur QA refusait déjà le rollback d'une tentative AutoMod F02 périmée, mais pouvait restaurer une sauvegarde F08 `streamcockpit-prediction-intents.sqlite` ou F09 `streamcockpit-moments.sqlite` plus ancienne que le journal actif. Il pouvait aussi promouvoir une copie ne tenant compte que du fichier SQLite principal malgré un fichier de transaction SQLite laissé actif.
- RED : **14 PASS / 4 FAIL / 0 skipped** sur `streamcockpit3-upgrade-qa-checkpoint.test.ts`. Les régressions utilisent les véritables adaptateurs SQLite F08/F09 sur Windows et des snapshots isolés.

## Modification intégrée en source
- Le garde QA auparavant réservé au journal F02 vérifie maintenant les **trois fichiers canoniques** stockés dans le `dataDir` de FIXE :
  - `streamcockpit-automod-action-intents.sqlite` (F02) ;
  - `streamcockpit-prediction-intents.sqlite` (F08) ;
  - `streamcockpit-moments.sqlite` (F09).
- Toute différence entre le journal sauvegardé et `active` (absence d'un côté, ajout, modification de taille ou SHA-256, fichier non régulier, lien, hardlink, lecture instable) refuse migration et restauration. Aucun fichier actif ou sauvegardé n'est réécrit.
- Les sidecars SQLite `-journal`, `-wal` et `-shm` sont refusés s'ils figurent dans la sauvegarde ou sur le journal actif : la copie du seul fichier principal ne suffit pas à prouver l'absence de transaction.
- Le contrôle intervient après vérification du manifeste et **à nouveau avant la promotion** des copies `migrated` ou `restored`. La copie de travail est détruite en cas d'échec, sans affecter le journal source.

## Qualification
- Cinq nouveaux tests QA couvrent : copie et restauration byte-for-byte des vrais journaux F08/F09, refus d'un nouveau F08, refus d'un nouvel événement F09, fichiers apparus/disparus, et sidecar SQLite incomplet. Deux tests supplémentaires couvrent une réservation F08 concurrente au milieu de migration et un sidecar `-wal` présent dans le manifeste.
- 8 suites F02/F08/F09/F10, migration et roadmap : **113 PASS / 0 FAIL / 0 skipped** sur les sources du lot, y compris tests SQLite Windows réels. Les fournisseurs Twitch/OBS restent simulés.
- `npm run build:types` : PASS après correction de deux erreurs de raffinement TypeScript dans le garde de journal ; `npm run check:browser-types` : PASS.
- `npm run security:check` : PASS (**6 786 fichiers**, avant ajout du présent rapport). `git diff --check` : PASS, avertissements CRLF non bloquants.
- Aucun test Microsoft Edge supplémentaire : aucune interface n'a été modifiée. Pas de suite générale, build EXE, APK, signature ou modification de profil utilisateur.

## Limites et suite
Ceci reste une **qualification sur copies temporaires Windows**. Une écriture qui survient après la seconde vérification n'est pas atomiquement empêchée. La fermeture de G4 exige un vrai protocole de quiescence de tous les écrivains FIXE, un inventaire de toutes les données durables, des sauvegardes hors bande anti-retour en arrière, des signatures Windows/Android de production et des essais de rollback sur appareil autorisés. Aucun rollback de production, aucune coupure secteur ni session Twitch réelle n'ont été essayés.
**F02/F08/F09/F10 restent `partial` ; G2 `in_progress` et G3–G5 `open`.** ClipForge avancé reste reporté en V4. Prochaine priorité : intégration de la transaction d'installation/migration avec pause vérifiable des producteurs durables puis réception et signatures, sans empiéter sur le chantier F05.
