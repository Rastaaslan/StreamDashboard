# StreamCockpit 3.0 — Lot F, deuxième vague

Mission Le StreamCockpit 3.0 Full Experience, nouvelle vague sur base 627dca3. Lire docs/streamcockpit-3/PLAN.md, CONTINUITY.md, feature-matrix.json. Twitch-only, OBS maître uniquement FIXE; ne jamais toucher aux PCs, OBS/Twitch réel, secrets, WorldPrep, Director ou autres worktrees. Test ciblé maxWorkers=1, pas de build Windows/Android, pas de mutation data utilisateur. Brancher seulement interfaces fiables, erreurs visibles, no false success. Commit sur ton lot avec rapport de tests et limites. Ne modifie pas la matrice de preuve partagée, l'intégrateur validera.

## Mission
MIXEUR AUDIO F05 - première passe sûre. Créer contrat de télémétrie et plan de contrôle audio depuis l'inventaire OBS et sorties locales, sans mutation. Reprendre l'existant audio-destinations.ts et données Voicemeeter/VOD comme contexte, mais ne pas changer leurs fichiers. Fournir table read-only des sources/gain/mute, niveau connu vs inconnu, routes stream/monitor/VOD et préconditions de plan de changement (expected revision, validation de sources, rollback). Aucun ordre d'OBS gain/mute réel ni automatisation audio sans confirmation. Nouveaux fichiers uniquement packages/core/src/streamcockpit-mixer*, apps/server/src/streamcockpit-mixer*, apps/mobile/control/streamcockpit-mixer*, tests/streamcockpit3-mixer*, docs/streamcockpit-3/LOT_F*. Tests incohérences, défaut USB, source disparue, double PC, VOD Spotify séparée.

## Exigences de sortie
Lister les fichiers réels, tests exécutés et résultat, limites, vrais branchements nécessaires. Aucun statut qualified sans vérification matérielle. Commit uniquement dans cette branche et aucun push ni déploiement.
