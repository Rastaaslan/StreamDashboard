# Installation Windows

## Démarrage en un double-clic

1. Installer Git et Node.js 20 ou supérieur.
2. Copier `.env.example` vers `.env` et définir notamment un `DEVICE_SECRET` robuste et le mot de passe OBS.
3. Double-cliquer `Lancer_StreamDashboard.cmd`.

Le launcher charge `.env`, conserve les variables déjà définies dans Windows, puis vérifie avant tout lancement : OBS, StreamTool (`/api/state`), damPlanner (`/api/calendar`) et StreamDashboard (`/api/state`). Il attend au maximum 25 secondes chaque service. Les processus sont lancés avec `Start-Process` et restent actifs après la fermeture de la fenêtre. À la fin, un tableau `OK`/`ECHEC` est affiché et le cockpit s'ouvre automatiquement si le Dashboard répond.

Le bootstrap partagé (`scripts/bootstrap.ts` et `data/repositories.json`) cherche un chemin configuré, le repo frère, l'ancien emplacement dans le profil utilisateur, puis clone le dépôt officiel dans `.dependencies`. Il détecte `pnpm-lock.yaml`, `yarn.lock` ou npm, et choisit le premier script disponible parmi `start`, `dev`, `serve`.

## Configuration

- `OBS_EXE_PATH` : chemin complet de `obs64.exe` (sinon les dossiers Program Files standards sont testés).
- `OBS_URL` : URL WebSocket OBS consommée par le Dashboard.
- `STREAMTOOL_URL` / `STREAMTOOL_PATH` : URL et dépôt local de StreamTool.
- `DAMPLANNER_URL` / `DAMPLANNER_PATH` : URL et dépôt local de damPlanner.
- `PUBLIC_URL` : URL publique du Dashboard, utilisée pour le contrôle de santé et l'ouverture du navigateur.

Tout composant déjà actif est laissé intact. Si OBS ou un service échoue, le launcher continue les étapes suivantes en mode dégradé.
