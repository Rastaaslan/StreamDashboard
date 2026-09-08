# StreamDashboard

Cockpit local Desktop et PWA mobile qui agrège **damPlanner** (planning), **StreamTool** (séquences/timer) et **OBS** (diffusion/audio/scènes), sans recopier leurs moteurs métier.

## Démarrage

Node 20+ : `npm install`, puis `npm run dev`. Ouvrir <http://127.0.0.1:47832>. Sous Windows, **double-cliquer simplement `Lancer_StreamDashboard.cmd`** : le launcher vérifie OBS et les trois services, ne redémarre pas ceux qui répondent déjà, localise les repos annexes, puis ouvre le navigateur. Une panne isolée n'empêche pas le reste du setup de démarrer.

Variables et ports figurent dans `.env.example`. Tests : `npm test`. Smoke contre un serveur lancé : `npm run smoke`.

## Applications

- Desktop : Dashboard, Planning, Live, Deck, Diagnostics, Settings.
- Mobile/PWA responsive : Accueil, Planning, Live, Deck, Réglages.
- API d'orchestration et WebSocket authentifié : `apps/server`.

Voir [l'architecture](docs/ARCHITECTURE.md), [le développement](docs/DEVELOPMENT.md) et [l'installation Windows](docs/INSTALL_WINDOWS.md).
