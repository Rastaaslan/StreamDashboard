# Architecture

```text
damPlanner ─HTTP lecture─┐
StreamTool ─HTTP─────────┼→ API StreamDashboard → état agrégé → WebSocket → Desktop/PWA
OBS ─obs-websocket───────┘
```

Les adapters isolent les pannes. L'agrégateur conserve le dernier planning valide, calcule le prochain LIVE non brouillon, signale un stream sans événement futur et publie chaque transition. StreamTool reste propriétaire des séquences et du timer; damPlanner du calendrier; OBS de son état. Le serveur n'en conserve qu'une projection.

La commande mobile aboutit à l'upstream, puis force une agrégation et un broadcast. Un polling de deux secondes couvre également les changements externes et complète la reconnexion OBS exponentielle.

La confiance est locale par défaut. À distance, le WebSocket et les mutations HTTP exigent device id + token. Le token aléatoire n'est stocké que sous forme SHA-256.
