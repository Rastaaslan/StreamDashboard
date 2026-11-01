# Migration de développement 3.0 vers FIXE — 2026-11-01
**État :** sources migrées, environnement Node restauré et tests ciblés effectués ; aucun déploiement ni qualification G3–G5.

## Autorité de travail
- FIXE Windows 11, `C:\Users\damie\Dev\StreamCockpit-3.0-FullExperience`, branche `streamcockpit/3.0-full-experience`, HEAD de transfert `2f2c2d8`.
- Lot F09 Q isolé : `C:\Users\damie\Dev\StreamCockpit-3.0-F09-Q`, branche `streamcockpit/3.0-f09-moments-read-20261101`, HEAD `4167b2b` ; **pas intégré**.
- Source Git distante `Rastaaslan/StreamDashboard` ; commits exacts contrôlés après clone/pull. Les 16 tickets historiques A–P ont été archivés dans `docs/streamcockpit-3/archived-wave-tickets/` et vérifiés sur FIXE.
- Automatisation horaire « Développement Le StreamCockpit 3.0 » modifiée pour travailler sur FIXE et ne plus réécrire dans les anciens worktrees dam-server.
- Sur dam-server : 16 lots A–P, Q et canonique 3.0 retirés par `git worktree remove --force`, **après vérification Git/archives et absence de processus actifs** ; 18 worktrees retirés, branches Git conservées dans l'historique commun et sur GitHub.
- Espace NVMe gagné au retrait : de 20 873 308 KiB libres à 21 051 384 KiB libres, soit **178 076 KiB ≈ 174 MiB** ; occupation encore 91 %. Les `node_modules` étaient des liens vers la RC2 et n'ont PAS été effacés. RC2, WorldPrep, Director et Crafty intacts.

## Prérequis du FIXE et validations
- FIXE : ~216 Go libres sur C: avant installation ; Git, Node 22.22.3/npm 10.9.8 et Java 21 détectés. OBS ouvert, aucune commande OBS/Twitch envoyée.
- `npm ci --ignore-scripts --no-audit --no-fund` : **PASS** dans canonique et Q, 260 paquets chacun, installations de développement seulement.
- Canonique Windows : `npm run build:types` **PASS**, `npm run security:check` **PASS (680 fichiers)** ; Vitest `streamcockpit3-health/context/twitch` **86/86 PASS (3 fichiers)**.
- Q Windows : `npm run build:types` **PASS**, `npm run security:check` **PASS (683 fichiers)** ; quatre suites F09 **34 PASS / 10 FAIL** (44 tests), log `%TEMP%\streamcockpit3-f09-fixe-20261101.log`.
- Cause reproduite indépendamment : `fs.promises.open(directory, 'r').sync()` renvoie **EPERM sous Windows/NTFS**. `MomentsFileStorage.compareAndSwap` exige ce fsync pour prétendre à une écriture durable et échoue avec `MOMENTS_WRITE_UNCERTAIN`. **Ne pas supprimer silencieusement le fsync ni traiter ces échecs comme un PASS** ; solution de persistance Windows avec garanties réelles à concevoir/tester.
- Le nouveau contrôle de révocation après lecture, même si elle est absente/échoue, passe dans les 34 tests réussis ; les échecs portent sur l'adaptateur de fichier. Q conserve son isolation.
- Aucune suite intégrale Windows, aucun build Windows/APK Android 3.0, aucune signature release, aucun test physique FIXE/laptop/Android ni migration/rollback de version effectués.

## Prochaines étapes
1. Résoudre et prouver la durabilité du journal F09 sur Windows sans régression de sécurité, puis rerun quatre suites Q, TypeScript, sécurité, revue et intégration sélective.
2. Revalider suite 3.0 et parcours mobiles/Agent V2 sur FIXE sous charge contrôlée ; préserver OBS en direct, autorité FIXE unique, minuteur maître et Twitch-only.
3. G2 encore `in_progress` ; G3–G5 `open`, F00–F10 `partial`. Candidate finale unique uniquement après preuves Windows+Android même commit, signature et rollback.
