# Installation Windows

1. Installer Git et Node.js 20 ou supérieur.
2. Copier `.env.example` vers `.env` et définir notamment un `DEVICE_SECRET` robuste et le mot de passe OBS.
3. Double-cliquer `Lancer_StreamDashboard.cmd`.

Le bootstrap cherche dans l'ordre le repo frère, le chemin `STREAMTOOL_PATH`/`DAMPLANNER_PATH`, l'ancien emplacement dans le profil utilisateur, puis clone l'URL GitHub officielle. Il détecte les lockfiles npm/pnpm/yarn et choisit le premier script disponible parmi start/dev/serve. Le launcher installe les dépendances Dashboard, démarre les services, puis ouvre le cockpit.
