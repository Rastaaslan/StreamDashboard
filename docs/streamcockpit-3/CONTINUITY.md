# Continuité — StreamCockpit 3.0 Full Experience

## 2026-11-01, lancement
- Autorisation explicite de poursuivre les dix chantiers StreamCockpit jusqu'à une expérience complète ; conserver RC2 comme référence de repli et ne pas distribuer d'alpha intermédiaire.
- Repo principal **inchangé** : `/home/damien/StreamDashboard-Alpha27-AgentV2-Integration`, branche `streamcockpit/fc1-integration-active-20261101`, commit gelé de référence `1cbb1d9c021eb20e2b4c6c4a8e12dcd0b50d3174`.
- Nouvelle branche et worktree autonomes : `/home/damien/StreamCockpit-3.0-FullExperience`, `streamcockpit/3.0-full-experience`; node_modules symlink pour éviter une copie disque.
- CodexBridge Debian : service et tunnel READY, capacité nominale 10, aucun job actif au début du passage. Priorité explicitement donnée à ne pas perturber WorldPrep ou Director.
- dam-server : partition NVMe 221 GiB, ~12 GiB libres (95 % utilisée). Les builds multi-plateformes lourds sont réservés aux gates d'intégration, pas à tous les jobs.
- Matrice des fonctionnalités : 11 références F00-F10, état « partial/planned » et preuves de la RC2 seulement ; aucune fonction déclarée qualifiée ni « finale » à ce stade.
- La porte de livraison G5 nécessite hardware réel Android + deux PC, récupération/rollback, signature Android existante et version commune Windows/Android. Ne pas confondre un test simulé et la validation matérielle.
- Tests de structure et de qualité de la matrice : `npx vitest run tests/streamcockpit-3-roadmap.test.ts --maxWorkers=1` — 3/3 PASS.

## Intégration et lots
- **Lot A :** F00/F01 Agent et santé read-only ; module séparé, pas de commande OBS active.
- **Lot B :** F02/F08 Modération et interaction Twitch ; vérification scopes, erreurs et confirmation.
- **Lot C :** F03/F07 Contexte macros / Deck ; moteur pur, aucune action automatique non autorisée.
- **Lot D :** F04/F09 Marqueurs et moments ; données durables et relecture, sans export ClipForge prétendu complet.
- Phases suivantes : F05/F06 mixage et planning assisté, F10 mise à jour sûre, puis clôture de chaque fonction à la matrice de preuves.
- Un intégrateur unique fait la revue et le rapprochement des branches. Les résultats CodexBridge sont **des propositions de code**, jamais des commits intégrés de façon automatique sans tests.
