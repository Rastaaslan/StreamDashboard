# Architecture V1 Desktop

StreamDashboard est un monolithe local en trois frontières : le contrat partagé (`packages/contracts`), l'orchestrateur HTTP/WebSocket (`apps/server`) et les clients (`apps/web`). L'interface n'appelle jamais OBS directement. Elle émet une commande typée vers `/api/commands`, puis reçoit l'état canonique par `state.updated`.

Le planning, la checklist, le timer et les préférences sont natifs et persistés dans `data/dashboard.json`. OBS est la seule intégration d'exécution. Son absence dégrade les contrôles OBS, sans empêcher planning, préparation ou diagnostics de fonctionner.

StreamTool et damPlanner ne font pas partie du graphe d'exécution V1. Leurs répertoires et processus ne sont jamais requis ou démarrés par le launcher.

## Extension future

Un futur client peut réutiliser `DashboardCommand`, `DashboardEvent` et `DashboardState`. La V1 ne contient volontairement aucun pairing, token device, QR code, manifest PWA ou navigation mobile.
