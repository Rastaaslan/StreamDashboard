# Audit des snapshots réels

Audit effectué le 8 septembre 2026 exclusivement dans `_integration_sources` du checkout.

## StreamTool

`src/api/app.ts` expose l'état public par `GET /api/state`, et le flux SSE `GET /api/events`. Les commandes protégées par Bearer sont `POST /api/intro/start`, `/api/pause/start`, `/api/pause/return`, `/api/end/start`, `/api/end/cancel`, `/api/sequence/cancel`, `/api/timer/pause`, `/resume`, `/reset`, `/add` et `/set`. Add/set reçoivent `{ "seconds": entier }`. L'état réel contient mode, running, timestamps/deadline, duration, remaining, timerVisible, previousObsScene, sequence, text et l'état OBS embarqué. L'adapter appelle ces routes; il n'importe ni `SequenceEngine`, ni `DeadlineTimer`.

## damPlanner

Le contrat demandé est `GET http://127.0.0.1:47831/api/calendar`, qui retourne directement `CalendarHub.load()` : `items`, `rows`, `warnings`, `fetchedAt`, `fromCache`. Les types `CalendarItem` observés incluent sources DAMPLANNER/GOOGLE/TWITCH, ownership, dates UTC, kind, draft et identifiants locaux/distants. Le snapshot montre aussi les handlers Electron du domaine, mais ils ne constituent pas une API HTTP publique et ne sont donc pas appelés.

Les snapshots ne sont jamais référencés au runtime.
