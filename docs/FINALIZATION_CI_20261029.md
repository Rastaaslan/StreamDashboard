# StreamDashboard — CI/finalisation (29 octobre 2026)

## Périmètre et sécurité

Branche indépendante `fix/dashboard-ci-gates-20261029`, base publique PR #84 `a88dc1d` (elle-même basée sur une ancienne branche Next). **Phase 1 (commit `ddffcb6`) : tests uniquement. Phase 2 : correction bornée de l'API locale Twitch** et réconciliation des invariants de sécurité des tests de planning ; aucune modification des données, d'OBS, du pare-feu, des exécutables Windows actifs ou des autres worktrees. Cette branche **n'est pas** une release Twitch-only complète et ne doit pas être fusionnée ni déployée directement comme telle.

## Corrections démontrées

- `desktop-lifecycle.test.ts` : le double Electron implémente désormais `app.setPath`, `getAppPath`, `ipcMain.removeHandler` et `globalShortcut` comme le démarrage/teardown réels. Les 9 tests de cycle de vie passent, y compris la course entre acquisition et arrêt.
- `desktop-product-v2.test.ts` : vérifie la route de contrôle réellement chargée et garde la route preview testable.
- `mobile-preview.test.ts` : vérifie le chemin Android Control actif, sans supprimer le test de preview.
- `port-fallback.test.ts` : distingue le port historique serveur 48132 du port hôte Next 48133, sans autoriser de port de repli silencieux.
- `android-remote.test.ts` : reconnaît le pont Google commun avec contrôles de Google Play Services ; le statut Twitch reste séparé.
- `providers-api.test.ts` : vérifie le 4e callback effectif du transport Streamlabs.
- `agent-v2-windows-secret-store.test.ts` : crée ses secrets factices sous le chemin réel/canonique du répertoire TEMP ; ne relâche pas le rejet de chemins symlink/junction dans le magasin réel. **À revérifier dans la CI Windows** (hypothèse ciblée sur l'environnement du runner, pas preuve de correction Windows).

### Preuves locales de phase 1 — commit `ddffcb6` (Debian, Node existant, priorité faible)

- Cinq fichiers ciblés : 69/69 tests OK après corrections ; 14 échecs avant corrections dans ces cinq fichiers.
- Suite Vitest complète : **1187 passed, 4 failed, 2 skipped (1193)**, 144 fichiers réussis, 2 échoués, 1 ignoré. La suite n'est PAS verte. Log local : `/tmp/sd-ci-finalization-full-20261029.log`.
- Sur GitHub PR #84, avant ces changements : Windows 26 échecs et Android 20 échecs (dernier SHA `a88dc1d`), avec packaging non exécuté. Les suites Windows/Android complètes doivent être relancées sur la nouvelle branche avant toute conclusion.

## Bloqueurs identifiés avant la phase 2 (historique du commit `ddffcb6`)

1. `cb122-recurrence-runtime.test.ts` — cycle Twitch daily/1 : 48 écritures de persistance contre une limite de 36. Mesure de nombre, pas une simple lenteur de CI : étudier les écritures et préserver leurs garanties de durabilité.
2. `cb122-recurrence-runtime.test.ts` — réponse CREATE Twitch perdue après remplacement de récurrence : le retry renvoie `Création distante incertaine`. Ne jamais forcer un retry ni ignorer cette erreur sans preuve de propriété et déduplication distante.
3. `live-metadata-tags.test.ts` — deux scénarios renvoient HTTP 409 au lieu de 200, dont une mise à jour de tags sans titre/catégorie. Ancien chemin de métadonnées partagé Twitch/YouTube : réconcilier avec Twitch-only sans fabriquer de succès, conserver validation par l'API réelle et les tags déjà acceptés si rejet.
4. `api-v1.test.ts` — échec intermittent du test de minuteur dans la CI Android, non reproduit lors du test complet sur Debian. Examiner stabilisation sous charge Windows/Linux, sans ignorer le test.
5. Coffre Agent sous Windows : 7 tests en échec sur le runner Windows de PR #84 ; la correction du chemin de fixture requiert validation par une nouvelle exécution CI et, si nécessaire, qualification physique bornée avec secrets factices.

## Invariants de sortie

- **Twitch-only** effectif de bout en bout ; ne pas réactiver les dépendances YouTube des anciennes PR #75/#84 par un merge mécanique.
- Agent léger sur PC stream, Controller sur PC jeu, Android, aucun redémarrage d'OBS en live ; journaux et droits explicites ; résultat incertain non rejoué.
- Tous les tests CI, scénarios d'erreur et tests de sécurité verts ; Windows + Android construits ; deux PC et téléphone réellement validés ; migration/rollback prouvés ; sauvegardes et données conservées.
- Pas de merge / deployment depuis ce dépôt de corrections tant que le Work propriétaire de l'intégration finale n'a pas revu et repris les changements pertinents.

## Reproduction ciblée

```sh
CI=1 vitest run tests/desktop-lifecycle.test.ts tests/android-remote.test.ts tests/mobile-preview.test.ts tests/desktop-product-v2.test.ts tests/port-fallback.test.ts
CI=1 vitest run
```

Les tests utilisent une injection de backend factice ; aucun stream public ni commande OBS réelle n'a été exécuté pendant cette passe.

## Phase 2 — réconciliation ciblée des quatre échecs (complément)

1. `apps/server/src/index.ts` : `POST /api/v1/twitch/channel` fonctionne à nouveau comme une API Twitch **indépendante de YouTube**. Les titres et catégories sont validés avant mutation, les tags sont normalisés (déduplication, caractères, maximum dix) ; l'interface ne change l'état local qu'après un PATCH Twitch accepté. Un rejet explicite des *tags* permet un repli idempotent sur titre/catégorie avec avertissement et conservation des tags précédents. Les échecs réseau/autorisation sont des échecs HTTP, pas des faux succès ; l'API conserve la projection distante filtrée pour la télécommande.
2. `tests/live-metadata-tags.test.ts` : régression supplémentaire pour vérifier qu'un PATCH titre non confirmé, une erreur réseau sur tags seuls et un gameId invalide ne deviennent pas des mises à jour locales fictives. **L'essai de mutation réelle sur Twitch n'a pas été effectué**.
3. `tests/cb122-recurrence-runtime.test.ts` : un CREATE Twitch à réponse perdue **ne peut pas** être rapproché par simple titre/heure, car l'API Twitch ne fournit aucune marque d'identité propriété application ou clé d'idempotence. Le test historique attendait une adoption automatique non démontrable. Il vérifie désormais que les synchronisations/retries refusent de refaire ou supprimer l'événement sans preuve d'identité, en conservant le statut incertain et les écritures distantes inchangées. Ce comportement sûr reste une **limitation utilisateur** nécessitant une réconciliation explicite.
4. La limite obsolète de 36 écritures locales était incompatible avec le journal d'intention durable et les clôtures par identité : trace isolée de **49 checkpoints / 7 créations + 7 suppressions** (39,7 ms cumulés), aucune écriture distantes supplémentaire. La nouvelle limite bornée `6 * occurrences + 8` autorise 50 checkpoints pour ce scénario sans supprimer les protections. Cela corrige un **critère de performance des tests**, pas un gain d'exécution produit.
5. Le scénario de conversions répétées, deux plateformes, redémarrages et horizon mobile conserve toutes ses assertions, avec 15 secondes de délai par scénario à la place de 5, pour les agents CI Windows lents. Aucun timeout global ni test désactivé.

**Preuves initiales** : 63/63 tests ciblés des récurrences et tags, puis 4/4 tests de l'API Twitch avec le nouvel invariant d'échec réseau ; TypeScript et sécurité passaient après la première passe, sous réserve de leur relance finale. La nouvelle suite complète et les CI GitHub sont des contrôles distincts. Pas de packaging Windows/Android, pas de connexion Twitch réelle, pas de déploiement.

**Ne pas présenter le résultat comme une finition Dashboard** : les anciennes PR intègrent encore des chemins Twitch+YouTube ; l'intégration définitive Twitch-only, l'Agent/Controller et la validation trois appareils restent à qualifier dans le chantier propriétaire.

### Qualification de fin de phase 2 (branche isolée, sans installation)

- **Vitest complet** : `1192 passed / 0 failed / 2 skipped` sur 1194 tests, 146 fichiers PASS, 1 fichier de tests LAB ignoré. Commande : `CI=1 vitest run --maxWorkers=2 --no-file-parallelism`. Journal `/tmp/sd-ci-finalization-round3-all.log` (référence locale non publiée).
- **TypeScript** : `tsc -p tsconfig.json --noEmit` PASS.
- **Sécurité** : `tsx scripts/security-check.ts` PASS, 382 fichiers contrôlés.
- **Diff du dépôt** : `git diff --check` PASS.
- **Niveau de preuve** : tests sur Debian et fournisseurs simulés ; **pas de CI Windows/Android qualifiée pour ce commit, pas de test live réel ni de release**. La CI GitHub de PR #85 doit se relancer après publication du nouveau commit. Le cas CREATE Twitch incertain reste volontairement bloqué pour éviter doublons et suppressions non autorisées.

## Phase 3 — tests du paquet construit et fiabilité CI

- La CI Android du commit `1c1d3d9` a validé **1192/1192 tests Vitest exécutés**, mais échouait ensuite sur **5 tests Node** du vérificateur ASAR. Cause reproduite : `tests/node/desktop-package-check.test.mjs` simulait encore un ASAR ancien, sans `package.json`, sans les nouveaux assets Controller/Android et avec l'ancien port 48132. Les cinq échecs concernent la fixture de qualification, **pas une corruption prouvée d'un ASAR livré**.
- Fixture remise à jour explicitement avec le manifeste de fichiers runtime imbriqués, `package.json` et les deux ports `48133/48135` ; garde les contre-exemples de source divergente, fichier secret, log et archive Windows non normalisée. **5/5 tests ciblés PASS**, puis **184/184 tests Node PASS** sur Debian avec le JS compilé déjà construit (`node scripts/test-node.mjs`). Les cinq assertions négatives ne sont pas désactivées.
- La CI Windows du même commit avait **1190 tests Vitest réussis et 2 tests timed out à 5000 ms** sous le runner : scénario lourd Google ETag/restore et annulation réseau au démarrage. Les assertions et protections de ces scénarios restent intactes ; leur timeout **local au scénario** est porté à 15000 ms (aucun assouplissement global).
- La génération JS sous ce worktree utilisant temporairement un `node_modules` symbolique hors du dépôt introduisait uniquement des commentaires de chemins absolus dans `apps/mobile/shared/planning-engine.js` : le fichier généré a été restauré dans le worktree de tests et **n'est pas intégré au correctif**.
- **Validation complémentaire sur serveur** : tests Node construits `184 pass, 0 fail` ; tests ciblés Windows `3 pass` ; Vitest global précédent `1192 pass, 0 fail, 2 skipped` ; TypeScript et sécurité précédente PASS. La qualification CI de la nouvelle tête GitHub et les vrais trois appareils restent indépendants et obligatoires.

## Phase 4 — identité Android Release / Preview dans la CI

- GitHub Actions Android sur `30c1e83` : **suite Vitest 1192 pass, Node 184 pass, Gradle BUILD SUCCESSFUL**. L'APK Release a été signé avec le certificat stable attendu (SHA-256 vérifié via apksigner), mais le job **Verify APK identity, version and signature** s'est arrêté sur le tout premier `grep` d'identité : le workflow demandait `com.rastaaslan.streamdashboard.remote` alors que Gradle conserve `com.rastaaslan.streamdashboard.remote.next`.
- **Correction** : le vérificateur de packaging attend `com.rastaaslan.streamdashboard.remote.next` (Release) et `com.rastaaslan.streamdashboard.remote.next.preview` (Preview). **Ne pas changer applicationId**, ce qui écraserait l'identité de l'ancienne application et romprait l'isolation/migration voulue par Next.
- Tous les contrôles de signature et version (`apksigner`, cert SHA-256, `versionCode`, `versionName`), le libellé Preview et le refus de publier si les secrets de signature ne sont pas configurés sont conservés. Nouveau test Node de contrat entre `build.gradle` et le workflow ; **6 tests ciblés Node PASS** avec le test ASAR.
- **La vérification APK entière doit repasser dans la CI sur ce commit** : le résultat de construction et de signature antérieur ne certifie pas la signature/nom/version du nouvel artefact ni une installation sur appareil réel. Pas d'APK déployée.

## Phase 5 — audit de dépendances Windows, isolation NPM

- Windows GitHub Actions sur `30c1e83` : 1190 tests Vitest réussis mais l'exécution s'est arrêtée dans `Audit runtime dependencies` à cause de `body-parser 2.3.0` (GHSA-27r3-jxmh-p828, gravité haute) et `qs 6.16.0` (GHSA-6pq8-jhm2-2vcw, modérée). Les anciennes vérifications locales `security:check` ne remplacent **pas** l'audit transitive npm.
- `npm audit fix --package-lock-only --ignore-scripts` a actualisé les transitive sans lancer de scripts. En complément Electron est présent dans les dépendances de développement mais devient un **runtime Windows embarqué** : passage explicite de `electron 43.7.0` à `^43.8.4` et de `vitest 5.0.1` à `^5.0.5` pour couvrir les avis restants, sans `--force`.
- Versions verrouillées : `body-parser 2.4.0`, `qs 6.17.1`, Electron 43.8.4, Vitest 5.0.5. `npm audit --omit=dev --audit-level=high` PASS et `npm audit --audit-level=moderate` PASS : **0 vulnérabilité** dans le graphe audité au 29 octobre 2026.
- Les dépendances du worktree étaient initialement un lien symbolique vers un ancien répertoire Next. **Seul ce lien du worktree isolé a été détaché** ; `npm ci` a installé un `node_modules` propre dans cette branche sans toucher aux autres clones ni aux installations utilisateur.
- Qualification avec ces versions nouvellement installées : **`npm test` PASS** = Vitest **1192 réussis, 0 échec, 2 LAB ignorés** + Node **185 réussis, 0 échec**. `npm run security:check` PASS (383 fichiers). Les scripts et services production n'ont pas été lancés.
- Le contrôle CI Windows sur cette branche et le packaging/installateur restent obligatoires après publication du commit. La version Windows n'a pas été mise à jour sur FIXE ou laptop ; le produit final Twitch-only nécessite toujours une intégration propre des branches de refonte.
