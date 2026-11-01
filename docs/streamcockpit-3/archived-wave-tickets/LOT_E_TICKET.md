# StreamCockpit 3.0 — Lot E, deuxième vague

Mission Le StreamCockpit 3.0 Full Experience, nouvelle vague sur base 627dca3. Lire docs/streamcockpit-3/PLAN.md, CONTINUITY.md, feature-matrix.json. Twitch-only, OBS maître uniquement FIXE; ne jamais toucher aux PCs, OBS/Twitch réel, secrets, WorldPrep, Director ou autres worktrees. Test ciblé maxWorkers=1, pas de build Windows/Android, pas de mutation data utilisateur. Brancher seulement interfaces fiables, erreurs visibles, no false success. Commit sur ton lot avec rapport de tests et limites. Ne modifie pas la matrice de preuve partagée, l'intégrateur validera.

## Mission
INTEGRATION SANTÉ: Sur cette branche, relier le module déjà intégré apps/server/src/streamcockpit-health/index.ts au serveur existant ET une page accessible « Centre de santé » dans Android Plus. Tu es le seul propriétaire autorisé à modifier apps/server/src/index.ts, apps/mobile/control/control.js, apps/mobile/control/mobile-five-tab-ui.js et éventuellement politique de routes remote pour le lot E ; aucun autre lot ne les touche. Mapper uniquement des observations horodatées fiables depuis l'hôte OBS/Twitch/DJI : si source n'offre pas timestamp attesté, renvoyer UNKNOWN; aucun faux vert. Autorisation serveur read-only et n'expose jamais jetons/configuration secrète. L'UI conserve cinq onglets et le minuteur permanent, états offline explicites, aucune commande envoyée par la vue santé. Ajouter tests d'intégration HTTP et UI, revalider routes client/host. Consigner pourquoi G2 pas encore final.

## Exigences de sortie
Lister les fichiers réels, tests exécutés et résultat, limites, vrais branchements nécessaires. Aucun statut qualified sans vérification matérielle. Commit uniquement dans cette branche et aucun push ni déploiement.
