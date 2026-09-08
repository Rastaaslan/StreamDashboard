# Installation Windows

1. Installer Node.js 20+ et OBS Studio.
2. Activer le serveur WebSocket d'OBS et reporter si nécessaire `OBS_URL` et `OBS_PASSWORD` dans `.env`.
3. Double-cliquer `Lancer_StreamDashboard.cmd`.

Le launcher charge `.env`, détecte puis démarre OBS si nécessaire, installe les dépendances du seul StreamDashboard si elles manquent, attend l'API locale au maximum 25 secondes et ouvre le navigateur uniquement lorsqu'elle répond. Il ne cherche et ne lance ni StreamTool ni damPlanner.

Variables utiles : `OBS_EXE_PATH`, `OBS_URL`, `OBS_PASSWORD`, `PUBLIC_URL`, `PORT` et `DATA_FILE`.
