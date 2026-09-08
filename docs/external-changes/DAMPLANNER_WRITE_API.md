# API d'écriture damPlanner proposée (future)

StreamDashboard reste read-only tant que damPlanner n'expose pas ces opérations. Contrat minimal souhaité, sous authentification locale et avec validation/limites :

- `POST /api/events` : créer depuis l'`eventInputSchema`; réponse `PlannerRow`, 201.
- `PATCH /api/events/:id` : édition partielle avec `If-Match`/hash de conflit.
- `DELETE /api/events/:id` : suppression logique, 204.
- `POST /api/events/:id/publish` et `/retry` : publication et retry provider.
- `POST /api/calendar/adopt` : `{id, calendarId?}`.
- `POST /api/events/:id/lifecycle` : `{state}`.

Chaque réponse mutante devrait inclure une version/ETag et damPlanner devrait publier un SSE `GET /api/events/stream` (`calendar.changed`) pour éviter le polling. Codes attendus : 400 validation, 401/403 auth, 404, 409 conflit, 429 et 503 provider. L'idempotency key est requise pour les créations/retry mobiles.
