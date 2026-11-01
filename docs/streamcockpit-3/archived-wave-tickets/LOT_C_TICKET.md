# StreamCockpit 3.0 — Lot C / première passe

Mission autorisée: StreamCockpit 3.0 Full Experience, commit de base 79c7de3. Lire docs/streamcockpit-3/PLAN.md et feature-matrix.json. N'utiliser que ce worktree. Ne pas toucher aux installations utilisateur, OBS/Twitch réel, secrets, WorldPrep, Director, Crafty. Twitch-only. Aucun autre lot ne doit modifier tes nouveaux fichiers. INTERDICTION de modifier apps/server/src/index.ts, apps/mobile/control/control.js, mobile-five-tab-ui.js, package.json, package-lock.json ou la matrice partagée. Exposer des modules et contrats pour branchement ultérieur par intégrateur. Tests uniquement ciblés, maxWorkers=1; pas de builds Windows/Android. Ne jamais prétendre au statut qualifié sur simple tests unitaires. Commit uniquement des fichiers de ton lot en fin de passe.

## Travail
Macros/Deck contextuels F03/F07. Moteur pur de sélection de banques/actions selon scène, jeu, streamState, rôle appareil, capabilities. Schéma strict sans eval ni scripts arbitraires, priorités, fallback, état inconnu. Le moteur choisit PRÉSENTATIONS et ne déclenche JAMAIS de commande OBS/Twitch/timer. Adapter rendu mobile réutilisable et tests changement scène, jeu absent, perte réseau, conflit de règles, filtrage par rôles. Fichiers nouveaux seulement packages/core/src/streamcockpit-context*, apps/mobile/control/streamcockpit-context*, tests/streamcockpit3-context*, docs/streamcockpit-3/LOT_C*.

## Résultat
Documenter fichiers réellement modifiés, commandes et résultats de tests, limites et points de branchement; committer sur ta branche unique et rapporter sans présenter cela comme la livraison finale.
