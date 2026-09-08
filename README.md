# StreamDashboard V1 Desktop

Cockpit local et autonome pour piloter une session de streaming depuis une seule interface : préparation, OBS, diffusion, timer, planning, Control Deck, Fun Deck, réglages et diagnostics.

## Démarrage quotidien (Windows)

Double-cliquez sur **`Lancer_StreamDashboard.cmd`**. Le launcher démarre OBS s'il le trouve, lance StreamDashboard puis ouvre le cockpit. StreamTool et damPlanner restent entièrement indépendants et ne sont ni lancés, ni modifiés, ni requis.

## Développement

Node.js 20+ :

```bash
npm install
npm run dev
```

Ouvrez <http://127.0.0.1:47832>. Utilisez `npm run build`, `npm test` et `npm run smoke` pour les vérifications.

## Architecture

- `apps/server` : API locale, commandes partagées, événements WebSocket et stockage autonome dans `data/dashboard.json`.
- `apps/web` : cockpit desktop (aucune navigation, PWA ou association mobile en V1).
- `integrations/obs` : adaptateur OBS WebSocket avec reconnexion et état temps réel.
- `packages/contracts` : contrats stables et réutilisables par de futurs clients, sans coupler le serveur à une interface.

Les commandes passent toutes par `POST /api/commands`; les changements d'état sont publiés via l'événement `state.updated` sur `/ws`.
