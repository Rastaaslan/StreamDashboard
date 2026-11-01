# StreamCockpit 3.0 — Lot B / première passe

Mission autorisée: StreamCockpit 3.0 Full Experience, commit de base 79c7de3. Lire docs/streamcockpit-3/PLAN.md et feature-matrix.json. N'utiliser que ce worktree. Ne pas toucher aux installations utilisateur, OBS/Twitch réel, secrets, WorldPrep, Director, Crafty. Twitch-only. Aucun autre lot ne doit modifier tes nouveaux fichiers. INTERDICTION de modifier apps/server/src/index.ts, apps/mobile/control/control.js, mobile-five-tab-ui.js, package.json, package-lock.json ou la matrice partagée. Exposer des modules et contrats pour branchement ultérieur par intégrateur. Tests uniquement ciblés, maxWorkers=1; pas de builds Windows/Android. Ne jamais prétendre au statut qualifié sur simple tests unitaires. Commit uniquement des fichiers de ton lot en fin de passe.

## Travail
Twitch modération/interactions F02/F08. Examiner intégration Twitch existante. Premier incrément vertical vérifiable: validation et visibilité des scopes/permissions pour Shield Mode et AutoMod, puis une opération interactive sondage ou raid si API adaptée. Réseau injecté/mocks, interdiction d'action sans précondition/confirmation explicite; erreurs 401/403/429/unavailable, pas de faux succès. Composant UI des capacités read-only pour Android, tests ciblés. Nouveaux fichiers seulement integrations/twitch/src/streamcockpit-advanced*, apps/server/src/streamcockpit-twitch*, apps/mobile/control/streamcockpit-twitch*, tests/streamcockpit3-twitch*, docs/streamcockpit-3/LOT_B*.

## Résultat
Documenter fichiers réellement modifiés, commandes et résultats de tests, limites et points de branchement; committer sur ta branche unique et rapporter sans présenter cela comme la livraison finale.
