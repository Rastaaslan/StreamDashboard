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
