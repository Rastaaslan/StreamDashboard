# Architecture V1 Desktop

StreamDashboard est un monolithe local en trois frontières : le contrat partagé (`packages/contracts`), l'orchestrateur HTTP/WebSocket (`apps/server`) et les clients (`apps/web`). L'interface n'appelle jamais OBS directement. Elle émet une commande typée vers `/api/commands`, puis reçoit l'état canonique par `state.updated`.

Le planning, la checklist, le timer et les préférences sont natifs et persistés dans `data/dashboard.json`. Les adaptateurs OBS et Twitch sont directement intégrés : leur absence dégrade uniquement leurs fonctions respectives, sans empêcher planning local, préparation ou diagnostics de fonctionner.

L'adaptateur Twitch (`integrations/twitch`) réalise un OAuth générique Authorization Code + PKCE et appelle Helix directement. Les credentials sont privés côté serveur. La synchronisation fusionne les segments distants et publie les lives créés localement. L'adaptateur OBS calcule à chaque changement de scène les sources audio présentes dans la scène programme et les périphériques globaux ; le contrat transmet séparément la liste active afin que le mixeur masque le bruit des sources inactives.

StreamTool et damPlanner ne font pas partie du graphe d'exécution V1. Leurs répertoires et processus ne sont jamais requis ou démarrés par le launcher.

## Extension future

Un futur client peut réutiliser `DashboardCommand`, `DashboardEvent` et `DashboardState`. La V1 ne contient volontairement aucun pairing, token device, QR code, manifest PWA ou navigation mobile.
