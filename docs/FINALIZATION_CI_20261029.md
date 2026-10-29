# StreamDashboard — CI/finalisation (29 octobre 2026)

## Périmètre et sécurité

Branche indépendante `fix/dashboard-ci-gates-20261029`, base publique PR #84 `a88dc1d` (elle-même basée sur une ancienne branche Next). Corrections exclusivement dans les tests ; aucune modification de code applicatif, des données, d'OBS, du pare-feu, des exécutables Windows actifs ou des autres worktrees. Cette branche **n'est pas** une release Twitch-only et ne doit pas être fusionnée ni déployée directement comme telle.

## Corrections démontrées

- `desktop-lifecycle.test.ts` : le double Electron implémente désormais `app.setPath`, `getAppPath`, `ipcMain.removeHandler` et `globalShortcut` comme le démarrage/teardown réels. Les 9 tests de cycle de vie passent, y compris la course entre acquisition et arrêt.
- `desktop-product-v2.test.ts` : vérifie la route de contrôle réellement chargée et garde la route preview testable.
- `mobile-preview.test.ts` : vérifie le chemin Android Control actif, sans supprimer le test de preview.
- `port-fallback.test.ts` : distingue le port historique serveur 48132 du port hôte Next 48133, sans autoriser de port de repli silencieux.
- `android-remote.test.ts` : reconnaît le pont Google commun avec contrôles de Google Play Services ; le statut Twitch reste séparé.
- `providers-api.test.ts` : vérifie le 4e callback effectif du transport Streamlabs.
- `agent-v2-windows-secret-store.test.ts` : crée ses secrets factices sous le chemin réel/canonique du répertoire TEMP ; ne relâche pas le rejet de chemins symlink/junction dans le magasin réel. **À revérifier dans la CI Windows** (hypothèse ciblée sur l'environnement du runner, pas preuve de correction Windows).

### Preuves locales (Debian, Node existant, priorité faible)

- Cinq fichiers ciblés : 69/69 tests OK après corrections ; 14 échecs avant corrections dans ces cinq fichiers.
- Suite Vitest complète : **1187 passed, 4 failed, 2 skipped (1193)**, 144 fichiers réussis, 2 échoués, 1 ignoré. La suite n'est PAS verte. Log local : `/tmp/sd-ci-finalization-full-20261029.log`.
- Sur GitHub PR #84, avant ces changements : Windows 26 échecs et Android 20 échecs (dernier SHA `a88dc1d`), avec packaging non exécuté. Les suites Windows/Android complètes doivent être relancées sur la nouvelle branche avant toute conclusion.

## Bloqueurs produits non masqués

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
