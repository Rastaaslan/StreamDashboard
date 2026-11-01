# StreamCockpit 3.0 — Lot A / première passe

Mission autorisée: StreamCockpit 3.0 Full Experience, commit de base 79c7de3. Lire docs/streamcockpit-3/PLAN.md et feature-matrix.json. N'utiliser que ce worktree. Ne pas toucher aux installations utilisateur, OBS/Twitch réel, secrets, WorldPrep, Director, Crafty. Twitch-only. Aucun autre lot ne doit modifier tes nouveaux fichiers. INTERDICTION de modifier apps/server/src/index.ts, apps/mobile/control/control.js, mobile-five-tab-ui.js, package.json, package-lock.json ou la matrice partagée. Exposer des modules et contrats pour branchement ultérieur par intégrateur. Tests uniquement ciblés, maxWorkers=1; pas de builds Windows/Android. Ne jamais prétendre au statut qualifié sur simple tests unitaires. Commit uniquement des fichiers de ton lot en fin de passe.

## Travail
Centre de santé F00/F01. Écrire moteur diagnostic pur lisant snapshot hôte OBS/Twitch/micro/DJI/sync; diagnostics status unknown/healthy/degraded/critical avec provenance timestamp fraîcheur; absence télémétrie = unknown, aucun faux pourcentage DJI ni panne micro déduite du silence. Fournir adaptateur API read-only et composant UI mobile réutilisable. Alertes dédupliquées. Tester hors-ligne, skew horloge, reconnect, réapparition, source manquante. Nouveaux fichiers seulement dans packages/core/src/streamcockpit-health*, apps/server/src/streamcockpit-health*, apps/mobile/control/streamcockpit-health*, tests/streamcockpit3-health*, docs/streamcockpit-3/LOT_A*.

## Résultat
Documenter fichiers réellement modifiés, commandes et résultats de tests, limites et points de branchement; committer sur ta branche unique et rapporter sans présenter cela comme la livraison finale.
