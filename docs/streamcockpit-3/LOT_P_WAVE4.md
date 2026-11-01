# Lot P — wave4 — préflight updater F10 — 2026-11-01

Base constatée : `b2426969b310878eb97170ae12350331b968a708`, worktree `/home/damien/StreamCockpit-3.0-Lot-P`. PLAN, matrice, CONTINUITY et documentation wave1–3 consultés, notamment H (staged/rollback), E (observations UNKNOWN) et L (autorité/reprise). **G2 in_progress ; G3–G5 open ; F10 non qualifié.**

## Chemins livrés

- `apps/desktop/src/updater.ts` : branchement du préflight dans le parcours existant, suppression de l’appel direct à `quitAndInstall`, dialogue explicite de blocage.
- `apps/desktop/src/streamcockpit-upgrade.ts` : export du préflight depuis la façade existante du planner ; comportement du planner offline inchangé.
- `apps/desktop/src/streamcockpit-upgrade-preflight.ts` : diagnostic read-only typé, validation du contrat core et des preuves associées.
- `tests/streamcockpit3-upgrade-integration.test.ts` : preuves injectées et migration/rollback sur répertoire temporaire.
- `tests/streamcockpit3-upgrade-integration-updater.test.ts` : vrai `startUpdater` avec Electron simulé.
- `docs/streamcockpit-3/LOT_P_WAVE4.md` : ce rapport.

Aucun autre fichier métier modifié. Ticket préexistant `LOT_P_TICKET.md` exclu de l’indexation. Matrice, CONTINUITY, package.json, Agent, serveur et Android inchangés.

## Audit et décision

`main.ts` n’active le candidat updater qu’avec `--enable-candidate-updater`, sur le runtime propriétaire ; `updater.ts` exige également application packagée et Windows. Le feed existant appelle `checkForUpdates`, puis reçoit `update-downloaded`. Il n’expose pas ici le chemin exact des octets Squirrel ni un manifeste commun signé Windows/Android. L’ancien chemin vérifiait `assessRestartSafety`, demandait confirmation, nettoyait le runtime puis appelait directement `quitAndInstall`.

La garde serveur lit les sorties OBS et refuse leur activité/incertitude, les commandes en cours et les changements de génération/configuration ; elle ne prouve pas l’état public Twitch. De plus, le runtime control-only peut retourner safe sans OBS. Il serait incorrect de transformer ce booléen seul en preuve de disponibilité pour une mise à jour F10.

Le planner core possède une intention avant effet, réconciliation sans répétition et migration sur copie. Il n’existe pas encore de raccordement Squirrel garantissant sauvegarde complète, verrou interprocessus, vérification des octets exacts, migration transactionnelle et reçu après redémarrage. Un lancement réel serait donc insuffisamment prouvé. **Le préflight reste toujours `state: blocked`, `launchAllowed: false`, même si `releaseVerified: true`.** Aucune permission d’installation ne découle de ce dernier champ.

## Branchements réels et usage

`startUpdater(...)` conserve sa fonction de nettoyage retournée, enrichie de `.preflight(): Promise<DesktopUpgradePreflightReport>`. Cette méthode fonctionne aussi sans activer les checks Electron en environnement de développement. Le cinquième paramètre optionnel reçoit les producteurs read-only de preuves ; la garde existante du dashboard reste imposée par l’updater et ne peut être remplacée par ce paramètre.

Le bouton du candidat updater appelle réellement le préflight via la façade `streamcockpit-upgrade.ts`, qui utilise `validateUpgradeManifest` du core. Le quatrième callback historique de nettoyage reste accepté pour compatibilité des appelants, mais n’est jamais invoqué pendant un blocage. Le préflight ne crée pas de planner ni n’appelle `prepare/install/rollback` : ces méthodes ont des effets, incompatibles avec ce diagnostic read-only.

Contrôles implémentés :

- Garde de redémarrage existante, puis OBS idle ET Twitch offline, autorité FIXE, session non vide, timestamp fini, non futur et âgé d’au plus 5 secondes. Aucun état déduit de l’absence de réponse.
- Relecture après vérification et refus d’un changement de session Agent, d’une déconnexion, d’une observation périmée ou d’un live commencé pendant les vérifications.
- Manifestes core valides, signatures présentes, cibles desktop/android, même SHA Git complet de 40 caractères et même version cible ; identités application, signataires et versions source concordant avec l’installation déclarée.
- Journal verified lié au manifeste Windows exact et à son chemin staged ; refus d’une intention interrompue, d’une installation déjà confirmée ou d’un rollback.
- `verifyRelease` doit retourner strictement true. Son contrat exige authentification du lien complet révision/identités/manifestes, signatures et empreintes des deux artefacts staged, confiance indépendante et attestation des identités installées. Absence, faux ou exception = refus. Les chaînes de signature ne constituent pas une preuve.

**Non branchés** : producteurs authentifiés OBS/Twitch, vérificateur cryptographique, clés épinglées, lecture des vraies identités installées, artefacts Squirrel/APK et lien au téléchargement courant, verrou global avec l’Agent, stockage durable production, migrations métier, installateur, restauration application/données et relecture après boot. Aucun vrai certificat ou clé n’est disponible ou revendiqué. Le callback de vérification est une frontière de confiance, pas une implémentation cryptographique. Les tests utilisent explicitement des valeurs synthétiques et un vérificateur simulé.

## Impact UX et absence d’effets critiques

Le dialogue indique « Mise à jour téléchargée », propose « Plus tard » ou « Vérifier le préflight » (Plus tard par défaut), puis affiche « Mise à jour bloquée » et les motifs. Après ce diagnostic, le watcher existant ne réaffiche pas automatiquement la même offre tant qu’aucun nouvel événement downloaded n’arrive. Les checks périodiques et le report existants sont conservés ; aucun minuteur de régie ajouté. Les fonctions de contrôle OBS/minuteur/Twitch ne sont pas appelées et le runtime n’est pas arrêté.

La capacité ancienne d’installation directe est volontairement neutralisée. Aucun téléchargement n’a été exécuté pendant cette mission : tous les objets Electron des tests sont simulés. Le code conserve le mécanisme de recherche/téléchargement existant du candidat lorsqu’un utilisateur l’active ; cette mission ne l’a pas activé.

## Tests et preuves

Commandes exécutées dans ce worktree, toutes les vérifications CPU/I/O sous `nice -n 15 ionice -c 3`, Vitest avec un worker maximum (les nombres de workers « spawned » affichés sont séquentiels par fichier).

```sh
nice -n 15 ionice -c 3 node node_modules/vitest/vitest.mjs run tests/streamcockpit3-upgrade-integration.test.ts tests/streamcockpit3-upgrade-integration-updater.test.ts tests/streamcockpit3-upgrade.test.ts tests/desktop-restart-safety.test.ts tests/desktop-updater-safety.test.ts --maxWorkers=1 --configLoader runner --no-cache
```

Passage final élargi : **code 1, 60 PASS / 2 FAIL, 5 fichiers**. Les deux échecs dans `tests/desktop-updater-safety.test.ts` sont les attentes legacy `performs its last check before teardown, then installs only after cleanup succeeds` et `keeps installation pending if cleanup fails`. Elles exigent l’ancien callback de nettoyage/installation, maintenant interdit sans transaction prouvée. Les six autres scénarios du fichier passent. Ce fichier est hors propriété du lot P et n’a pas été modifié : **la suite élargie n’est pas verte ; adaptation des attentes nécessaire par son propriétaire avant intégration**. Aucun contournement permissif pour faire passer ces assertions.

Premier passage avant ajout du scénario rollback temporaire réussi : 59 PASS / 2 FAIL ; sortie dans `/tmp/lot-p-wave4-tests.log`. Le wrapper de cette première commande finissait par `cat` (code shell 0), mais Vitest échouait ; le passage final ci-dessus expose directement le code 1.

```sh
nice -n 15 ionice -c 3 node node_modules/vitest/vitest.mjs run tests/streamcockpit3-upgrade-integration.test.ts tests/streamcockpit3-upgrade-integration-updater.test.ts tests/streamcockpit3-upgrade.test.ts tests/desktop-restart-safety.test.ts --maxWorkers=1 --configLoader runner --no-cache
```

Dernier passage après export depuis la façade : **code 0, 54/54 PASS, 4 fichiers**. Cette sélection ne remplace pas le résultat élargi ci-dessus.

```sh
nice -n 15 ionice -c 3 npm run build:types
nice -n 15 ionice -c 3 npm run security:check
nice -n 15 ionice -c 3 node --import tsx scripts/security-check.ts
```

- `build:types` : code 0 aux deux passages, dont un après derniers changements de code.
- `security:check` : code 1 avant analyse, socket IPC `tsx` interdit par sandbox (`listen EPERM`).
- Repli autorisé `node --import tsx ...` : code 0, **663 fichiers contrôlés**.
- `git diff --check` : code 0.

Les nouveaux tests vérifient live/UNKNOWN pour OBS et Twitch, données absentes/périmées/futures, déconnexion, changement de session, signatures manquantes/refusées, vérificateur absent/en erreur, révisions et identités divergentes, journal incompatible et intention incertaine. Le test updater prouve zéro nettoyage/`quitAndInstall`, blocage affiché, absence de rejeu par watcher et diagnostic sans timer en développement.

Les tests sur fichiers temporaires utilisent réellement `migrateUpgradeData` et `createDesktopUpgradePlanner`, écrivent un journal, une sauvegarde, une migration et des données actives synthétiques. Ils reconstruisent le planner depuis le journal, vérifient installation/rollback simulés avec relecture des données, refus de réexécution après effet incertain, refus de rollback incertain et conservation de tous les fichiers/associations/profils. Une migration destructive est rejetée. Les dossiers `/tmp/lot-p-upgrade-*` créés par les tests sont seuls supprimés par leur nettoyage. Les adapters fichiers de test ne sont pas un stockage production : pas de preuve fsync, verrou interprocessus, crash OS ou coupure secteur Windows.

## Limites de livraison

Aucun installeur, démarrage/arrêt live, commande OBS réelle, publication planning, mise à jour système, reboot, build Windows/APK, full npm test, push ou déploiement. Aucun accès aux installations FIXE/laptop/Android, profils, secrets, RC2, WorldPrep, Director ou Crafty. La durée maximale de réponse des providers reste leur responsabilité ; un provider suspendu ne peut autoriser un lancement. L’attestation physique FIXE, le matériel, les signatures release et le rollback physique restent à qualifier. Aucune gate fermée.

## Indexation / commit

Commande réellement tentée :

```sh
git add apps/desktop/src/updater.ts apps/desktop/src/streamcockpit-upgrade.ts apps/desktop/src/streamcockpit-upgrade-preflight.ts tests/streamcockpit3-upgrade-integration.test.ts tests/streamcockpit3-upgrade-integration-updater.test.ts docs/streamcockpit-3/LOT_P_WAVE4.md
```

Code **128** : `Unable to create '/srv/storage/nvme-archives/2026-10-30/dashboard-history/StreamDashboard-Next-work/.git/worktrees/StreamCockpit-3.0-Lot-P/index.lock': Read-only file system`. Aucun contournement, aucune nouvelle tentative d’indexation et aucun commit lancé. Code et rapport conservés dans le worktree. Ticket non inclus dans la commande. L’intégrateur devra indexer depuis un environnement dont les métadonnées Git sont accessibles en écriture.

## Revue d'intégration 2026-11-01 11:15–11:20 CET (en attente de tests)
- L'intégrateur a revérifié la branche P séparément : aucun Codex actif, modifications P non intégrées, aucun déploiement. Pression disque serveur `/proc/pressure/io` **full avg10 ~69–71 %**, plusieurs tâches étrangères en état D dans ext4 ; conserver l'interdiction de nouveaux gros tests/builds pendant cette saturation.
- Faille potentielle de confidentialité repérée en revue : `preflightDesktopUpgrade` reprenait directement `Error.message` d'un provider externe dans `report.reasons`, ensuite exposé au dialogue Electron et au logger ; une erreur HTTP/OAuth aurait pu divulguer un jeton. Correctif préparé **uniquement dans le worktree P** : classe interne `PreflightRejected` pour les seuls motifs sûrs, les erreurs externes remplacées par une formulation générique sans reflet de détails.
- Ajout de **quatre nouveaux cas ciblés non encore exécutés** (erreurs `assessRestartSafety`, `observe`, `evidence`, `verifyRelease` contenant un faux Bearer token). `git diff --check` PASS, mais aucune suite Vitest/TypeScript/sécurité relancée sous contention I/O ; les chiffres 54 PASS historiques précèdent cette correction.
- **Décision : P non intégré, F10 partial et G2 in_progress.** Reprendre la validation élargie 5 fichiers, TS et sécurité lorsque PSI I/O et état du système le permettront, sans toucher à la RC2 ni à l'installateur réel.

## 2026-11-01 12:17–12:23 CET — revue de sécurité supplémentaire sous contention I/O
- Contexte : contrôle exclusif via Remote Desktop Commander, branche canonique 3.0 `6bd92bb` propre au départ. Lot P encore isolé. Aucune session Codex A–P active. `/proc/pressure/io` full avg10 **60.22 %** au départ, puis **53–59 %** ; disque **190G/221G, 21G libres (91 %)**. Producteur WorldPrep et audits étrangers en D : intacts.
- **Correctif P non intégré :** le préflight refuse désormais également une horloge locale `NaN`/`+Infinity`/`-Infinity` avant toute validation. Trois scénarios Vitest ajoutés ; **smoke réel Node+tsx isolé 3/3 PASS**, sortie de commande code 0, sans effet d'installation (`nice 19`, `ionice idle`).
- **Journal de l'updater P durci :** erreurs externes de garde OBS/restart, dialogue Electron, événements `autoUpdater.error`, refus `checkForUpdates` ne sont plus journalisées avec leurs objets potentiellement porteurs de jetons. Les messages sont fixes et génériques. `checkForUpdates` synchrone qui lève une exception est désormais capturé, sans déclencher d'installation ni crash attendu. Tests Vitest avec faux jetons ajoutés ; adaptation de l'assertion legacy à la non-divulgation.
- Vérification statique : `node --check` **5/5 fichiers PASS** (préflight, updater, 3 tests), `git diff --check` PASS. Ce **n'est pas** une validation TypeScript, Vitest, sécurité ou packaging intégrée. Aucune de ces suites lourdes n'a été lancée, conformément à la contention I/O.
- **Décision inchangée :** P ne peut pas être cherry-pické avant reprise des 5 fichiers de tests, TypeScript et sécurité sur machine désaturée ; ensuite suite canonique `npm test`, Playwright, matériel et signature obligatoires. Le téléchargement existant peut toujours être proposé en mode diagnostic candidat ; le préflight interdit en toutes circonstances `quitAndInstall` (transaction non raccordée).
