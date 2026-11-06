# F10 — Raccordement des vrais écrivains SQLite FIXE au contrôle de maintenance

**06/11/2026 — FIXE uniquement, RDC.** Base `3d46170ab566a644ccd3ba49768b04cfd2cc3b0a`; branche `streamcockpit/3.0-full-experience`. Aucune installation, profil, machine distante, OBS, Twitch ou secret manipulé. F05 et CONTINUITY réservés à leurs propriétaires, inchangés par ce lot.

## Écart réellement traité

Le verrou F10 `HostDurableWriterQuiescence` était exercé dans un laboratoire avec des instances SQLite créées par les tests. En production, `DashboardServer` construisait encore directement les écrivains F02 AutoMod et F08 prédictions, tandis que F09 instanciait un **nouveau** `MomentsSqliteStorage` par appel HTTP/événement. Le contrôle de maintenance ne protégeait donc pas les accès réels.

Le serveur Windows crée maintenant un **seul** `HostWindowsDurableJournals` par runtime : les interfaces F02 et F08 utilisées par les services Twitch sont protégées par le même `HostDurableWriterQuiescence`, et F09 réutilise une instance SQLite protégée, initialisée paresseusement pour ne pas bloquer le démarrage si la lecture facultative échoue. Les écritures concernées refusent les nouvelles admissions pendant un drainage, attendent les écritures acceptées et deviennent bloquées après un résultat de stockage incertain. Les lectures restent disponibles pendant la maintenance. Hors Windows, le chemin déjà existant est conservé.

La régie n'expose **aucune API de maintenance**, n'appelle **jamais** `withQuiesced` automatiquement, n'arrête pas OBS et n'active aucun installateur. C'est le raccordement effectif des trois écrivains F02/F08/F09 au serveur, pas l'autorisation d'installer en production.

## Preuves et régression

- **12 suites ciblées : 128 PASS / 0 FAIL / 0 skipped**, dont **5 nouveaux tests** sur les vrais adaptateurs Windows et le démarrage/arrêt d'un `DashboardServer` HTTP isolé avec OBS désactivé. Exercices : trois réservations/écritures SQLite, instance F09 unique sous concurrence, arrêt contrôlé et refus d'écriture, conservation des reçus après nouvelle instance, refus d'un journal F09 legacy non qualifié et blocage après erreur incertaine.
- Les suites existantes couvrent AutoMod, prédictions, SQLite F09, replays OBS simulés, Streamlabs, annulation du démarrage, compatibilité V4, journal F10 interprocessus et checkpoint/relecture après reprise. Les fichiers réellement utilisés sont des dossiers temporaires sans profils utilisateur.
- `npm run build:types`, `npm run check:browser-types`, `npm run security:check` (6 806 fichiers avant rapport) et `git diff --check` : **PASS**, code 0. Aucun parcours navigateur à modifier pour ce lot backend. Une première exécution du test nouvellement écrit a échoué en parsing (parenthèse de test corrigée), puis les suites finales sont vertes ; ce n'était pas une panne fonctionnelle.

## Ce qui reste — interdiction de promotion des gates

Le contrôle est encore **local à un processus** et ne garantit pas l'absence de writers provenant d'autres services, de processus externes, de F05 ou du stockage général. Une maintenance réelle exige d'abord le drainage de l'ensemble du serveur et l'exclusion interprocessus, puis un installateur qualifié avec identité Windows/Android signée, reçus et rollback sur les appareils réels. Node 22 `node:sqlite` reste expérimental. Aucun utilisateur, fournisseur, OBS physique, signature de production, coupure électrique ou mise à jour matérielle n'a été testé ici. **F10 partial ; G2 in_progress ; G3–G5 open.**

**Prochaine action prioritaire :** coordonner le drainage complet du runtime avec le verrou F10 et un adaptateur de mise à jour réel dans un environnement isolé, sans brancher `startUpdater` ni toucher aux installations avant qualification et accord opérateur.
