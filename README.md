# StreamDashboard

Cockpit local Desktop et PWA mobile qui agrège **damPlanner** (planning), **StreamTool** (séquences/timer) et **OBS** (diffusion/audio/scènes), sans recopier leurs moteurs métier.

## Démarrage

Node 20+ : `npm install`, puis `npm run dev`. Ouvrir <http://127.0.0.1:47832>. Sous Windows, double-cliquer `Lancer_StreamDashboard.cmd` pour rechercher/démarrer les trois applications et ouvrir le navigateur.

Variables et ports figurent dans `.env.example`. Tests : `npm test`. Smoke contre un serveur lancé : `npm run smoke`.

## Applications

- Desktop : Dashboard, Planning, Live, Deck, Diagnostics, Settings.
- Mobile/PWA responsive : Accueil, Planning, Live, Deck, Réglages.
- API d'orchestration et WebSocket authentifié : `apps/server`.

Voir [l'architecture](docs/ARCHITECTURE.md), [le développement](docs/DEVELOPMENT.md) et [l'installation Windows](docs/INSTALL_WINDOWS.md).
