# StreamCockpit 3.0 — Lot H, deuxième vague

Mission Le StreamCockpit 3.0 Full Experience, nouvelle vague sur base 627dca3. Lire docs/streamcockpit-3/PLAN.md, CONTINUITY.md, feature-matrix.json. Twitch-only, OBS maître uniquement FIXE; ne jamais toucher aux PCs, OBS/Twitch réel, secrets, WorldPrep, Director ou autres worktrees. Test ciblé maxWorkers=1, pas de build Windows/Android, pas de mutation data utilisateur. Brancher seulement interfaces fiables, erreurs visibles, no false success. Commit sur ton lot avec rapport de tests et limites. Ne modifie pas la matrice de preuve partagée, l'intégrateur validera.

## Mission
MISES À JOUR SÛRES F10 - première passe. Construire un planificateur de mise à jour staged qui applique les garde-fous existants startUpdater/requireDesktopRestartSafety, refuse quand OBS émet OU que son état est unknown, préserve associations et profils via migration versionnée et sauvegarde, rollback explicite et journal idempotent. Contrat d'update (manifest, version, source/signature, étapes downloaded/staged/verified/deferred/installed/rolledBack) avec injection d'adapters, pas de téléchargement réseau ni d'installateur réel. Nouveaux fichiers uniquement apps/desktop/src/streamcockpit-upgrade*, packages/core/src/streamcockpit-upgrade*, tests/streamcockpit3-upgrade*, docs/streamcockpit-3/LOT_H*. Tester live actif/état inconnu, crash, signature non vérifiée, rollback. Pas de modification d'updater.ts avant intégration.

## Exigences de sortie
Lister les fichiers réels, tests exécutés et résultat, limites, vrais branchements nécessaires. Aucun statut qualified sans vérification matérielle. Commit uniquement dans cette branche et aucun push ni déploiement.
