# StreamCockpit 3.0 — Lot D / première passe

Mission autorisée: StreamCockpit 3.0 Full Experience, commit de base 79c7de3. Lire docs/streamcockpit-3/PLAN.md et feature-matrix.json. N'utiliser que ce worktree. Ne pas toucher aux installations utilisateur, OBS/Twitch réel, secrets, WorldPrep, Director, Crafty. Twitch-only. Aucun autre lot ne doit modifier tes nouveaux fichiers. INTERDICTION de modifier apps/server/src/index.ts, apps/mobile/control/control.js, mobile-five-tab-ui.js, package.json, package-lock.json ou la matrice partagée. Exposer des modules et contrats pour branchement ultérieur par intégrateur. Tests uniquement ciblés, maxWorkers=1; pas de builds Windows/Android. Ne jamais prétendre au statut qualifié sur simple tests unitaires. Commit uniquement des fichiers de ton lot en fin de passe.

## Travail
Moments marquants/marqueurs F04/F09. Pipeline de données durable pour moment: session, instant, source OBS/Twitch/manuel/Streamlabs, correlationId, titre, statut, clip reference optionnelle. Validation, idempotence, déduplication, ordre, stockage atomique injecté; tests corruption, replay, crash, absence secrets. Fournir composant timeline mobile read-only et contrat d'export de marqueurs. Ne pas prétendre ClipForge vertical/MP4 terminé. Fichiers nouveaux seulement packages/core/src/streamcockpit-moments*, apps/server/src/streamcockpit-moments*, apps/mobile/control/streamcockpit-moments*, tests/streamcockpit3-moments*, docs/streamcockpit-3/LOT_D*.

## Résultat
Documenter fichiers réellement modifiés, commandes et résultats de tests, limites et points de branchement; committer sur ta branche unique et rapporter sans présenter cela comme la livraison finale.
