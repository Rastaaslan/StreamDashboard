# Architecture V1 Desktop

StreamDashboard est un monolithe local en trois frontières : le contrat partagé (`packages/contracts`), l'orchestrateur HTTP/WebSocket (`apps/server`) et les clients (`apps/web`). L'interface n'appelle jamais OBS directement. Elle émet une commande typée vers `/api/commands`, puis reçoit l'état canonique par `state.updated`.

Le flux des actions respecte quatre couches : l'UI desktop émet un `DashboardCommand`, `DashboardCommandService` valide et distribue la commande, `packages/core` applique les règles métier pures (timer, modes, checklist), puis les adaptateurs `integrations/obs`, `integrations/twitch` et le stockage JSON exécutent les effets externes. Les routes HTTP ne contiennent donc plus la logique des commandes du cockpit.

Le planning, la checklist, le timer et les préférences sont natifs et persistés dans `data/dashboard.json`. Les adaptateurs OBS et Twitch sont directement intégrés : leur absence dégrade uniquement leurs fonctions respectives, sans empêcher planning local, préparation ou diagnostics de fonctionner.

L'adaptateur Twitch (`integrations/twitch`) utilise le Device Code Grant avec un Client ID public et appelle Helix directement. Il ne contient ni Client Secret, ni callback, ni redirect URI. Seuls les jetons propres à l'utilisateur sont persistés côté serveur. La synchronisation fusionne les segments distants et publie les lives créés localement. L'adaptateur OBS calcule à chaque changement de scène les sources audio présentes dans la scène programme et les périphériques globaux ; le contrat transmet séparément la liste active afin que le mixeur masque le bruit des sources inactives.

StreamTool et damPlanner ne font pas partie du graphe d'exécution V1. Leurs répertoires et processus ne sont jamais requis ou démarrés par le launcher.

## Extension future

Un futur client peut réutiliser `DashboardCommand`, `DashboardEvent` et `DashboardState`. La V1 ne contient volontairement aucun pairing, token device, QR code, manifest PWA ou navigation mobile.
