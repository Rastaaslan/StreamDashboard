# StreamCockpit 3.0 — Lot G, deuxième vague

Mission Le StreamCockpit 3.0 Full Experience, nouvelle vague sur base 627dca3. Lire docs/streamcockpit-3/PLAN.md, CONTINUITY.md, feature-matrix.json. Twitch-only, OBS maître uniquement FIXE; ne jamais toucher aux PCs, OBS/Twitch réel, secrets, WorldPrep, Director ou autres worktrees. Test ciblé maxWorkers=1, pas de build Windows/Android, pas de mutation data utilisateur. Brancher seulement interfaces fiables, erreurs visibles, no false success. Commit sur ton lot avec rapport de tests et limites. Ne modifie pas la matrice de preuve partagée, l'intégrateur validera.

## Mission
PLANNING ASSISTÉ F06 - premier incrément fini et testable. Inspecter planning-model et existing recurrence, créer moteur read-only de suggestions de créneaux depuis événements locaux/Google observés, détection de chevauchements, proposition de duplication de session, sans muter automatiquement calendrier ou Twitch. Gérer date Europe/Paris DST, séquences de récurrence et exceptions, IDs uniques à confirmation, conflit et annulation. UI proposition séparée et tests. Nouveaux fichiers uniquement packages/core/src/streamcockpit-planning*, apps/mobile/control/streamcockpit-planning*, tests/streamcockpit3-planning*, docs/streamcockpit-3/LOT_G*. L'intégrateur branchera à Planning; ne pas modifier planning.js ni module Google principal.

## Exigences de sortie
Lister les fichiers réels, tests exécutés et résultat, limites, vrais branchements nécessaires. Aucun statut qualified sans vérification matérielle. Commit uniquement dans cette branche et aucun push ni déploiement.
