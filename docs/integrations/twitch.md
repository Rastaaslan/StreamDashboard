# Twitch Live Control

The existing `TwitchClient` remains the single Helix adapter. Device Code Grant
now requests only scopes used by implemented capabilities:

* `channel:manage:schedule` and `channel:manage:broadcast` for existing planning
  and channel metadata;
* `user:read:chat` and `user:write:chat` for EventSub chat and sending messages;
* `moderator:read:chatters` for the chat roster;
* `clips:edit` for clip creation;
* `channel:manage:videos` for destructive VOD deletion.
* `moderator:manage:chat_messages` for deleting individual messages;
* `moderator:manage:banned_users` for timeout, ban and unban.

Implemented official Helix resources are `GET /streams`, `GET/DELETE /videos`,
`GET/POST /clips`, `GET /chat/chatters`, and `POST /chat/messages`. References:
[Twitch API reference](https://dev.twitch.tv/docs/api/reference/) and
[Twitch authentication scopes](https://dev.twitch.tv/docs/authentication/scopes/).

Chat reception uses Twitch EventSub WebSocket
`channel.chat.message`. The adapter handles welcome, subscription, reconnect URL,
bounded retry and parsing of badges, user color, fragments/emotes, replies, bits
and timestamps. Reference:
[EventSub WebSocket](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/)
and [subscription types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/).

The runtime polls live state and chatters every 30 seconds; chat itself is pushed.
Viewer count and chatters remain separate. Viewer count is never inferred from the
roster. Android receives a bounded 200-message buffer and renders at most the last
100 messages. VOD and clip lists use opaque Twitch pagination cursors.

VOD deletion requires the explicit phrase `DELETE <video id>` in both Android and
the server endpoint. Clip creation returns HTTP 202 because Twitch processes the
clip asynchronously. Existing credentials that lack new scopes remain usable for
planning, but chat/VOD actions return Twitch authorization errors until the user
reconnects; StreamDashboard does not fake availability.

Android queries moderation capabilities before rendering actions. Missing scopes
produce `TWITCH_NOT_AUTHORIZED` with the exact `requiredScope`; delete, timeout,
ban and unban are never shown as successful before the Helix response. EventSub
also uses a keepalive watchdog and bounded exponential reconnect delay.

CB-15 runtime audit:

* All protected mutations check their exact scope, including VOD deletion and
  schedule writes. Partial grants remain connected; a missing schedule scope does
  not disable unrelated chat or channel features.
* Device reauthorization validates the new identity/scopes before completion,
  cancels old requests, resets cached channel/audience data and replaces EventSub
  subscriptions. Snapshots carry the current capabilities to Desktop and mobile.
* Clip creation checks `/streams` immediately before the mutation and returns
  HTTP 409 offline. Chat, moderation, metadata and existing VOD/clip reads do not
  require a live stream.
* Live polling and chatter polling fail independently. Failed live reads clear
  the live indicator and viewer count; failed chatter reads clear the roster.
  `audience.viewer-count.updated` uses the event core's supported naming format.
* Only authentication failures clear stored credentials. HTTP 429 and provider
  failures preserve the session; API responses retain the HTTP status and numeric
  `Retry-After`. Provider error bodies and network error details are not forwarded
  to logs or mobile. A 403 triggers scope revalidation without replaying mutations.
* `channel:read:redemptions` enables custom rewards and Streamer Pings through
  EventSub. Obsolete sockets and notifications for a different broadcaster are
  ignored. Viewer count always comes from `/streams`, never from chatters.

Regression coverage: `tests/twitch-runtime-audit.test.ts` exercises the client and
EventSub lifecycle; `tests/twitch-runtime-api.test.ts` starts the runtime and checks
HTTP guards, live/audience transitions, mobile projection and secret redaction
using mocked Twitch responses. No live Twitch account is required by these tests.

Reauthorization stages the candidate token, `/users` identity and `/validate`
grant before replacing the active session. A 429/503 during either check keeps
the previous identity, scopes and persisted tokens together. Failed persistence
of a verified replacement disconnects and clears the session. The runtime tests
also restart the server after failed account switching to verify consistency.

Both mobile clip buttons require a connected PC, a connected Twitch session,
confirmed `clips:edit` capability and `controlHub.live.isLive === true`. OBS
streaming does not affect their availability. Behavioral renderer coverage is in
`tests/mobile-twitch-capabilities.test.ts`.

In a restricted worktree where `/tmp` is not writable, run Vitest with its
temporary directory inside the worktree:

```sh
mkdir -p .tmp
TMPDIR="$PWD/.tmp" npm test
```

### Projection des récurrences

Une série weekly-1 sans fin ni exception reste native. Les autres règles utilisent
le moteur générique `expandRecurringItems`, derrière l’interface `OccurrenceEngine`,
pour publier au plus les 7 prochaines occurrences valides à partir de maintenant (CB-129).
La projection est rafraîchie au démarrage après validation Twitch, à la synchronisation,
aux modifications du planning, au retry et toutes les 60 secondes dans la file de réconciliation.

Le lien Twitch expose `projectionMode`, `projectionWindow` et `projections`, indexé
par `occurrenceKey`. Chaque entrée conserve l’identité distante, le contenu appliqué,
son état et son erreur. Le téléphone reçoit les états par occurrence sans identités
ni journal interne. Une erreur isolée ne bloque pas les autres occurrences.
Seules les identités marquées comme gérées par StreamDashboard sont nettoyées lorsque
la fenêtre ou les exceptions changent. Un ancien lien natif dont l’ownership de
création n’est pas connu doit être retiré explicitement avant conversion.

Chaque CREATE est précédé d’une intention persistée. Une erreur certaine (par exemple
429) permet un retry ; une réponse perdue reste signalée comme création incertaine,
sans nouveau CREATE automatique, car Twitch ne fournit pas de clé d’idempotence.
Une simple correspondance de titre/horaire ne permet pas d’adopter puis supprimer
un segment externe. Les suppressions distantes connues nécessitent un retry explicite.

Les conflits de contenu restent bloqués par occurrence jusqu’à un choix explicite
« Conserver la version locale » ou « Conserver la version distante ». La route
`POST /api/v1/planning/:id/conflict/twitch` accepte `occurrenceKey` avec `strategy`
(`local` ou `remote`). Elle relit le segment et son empreinte avant résolution ;
le choix distant devient une exception persistée sur cette seule occurrence.
Un retry simple ne peut pas écraser une modification distante en conflit.
Le refresh reprend aussi une conversion matérialisée → native interrompue pendant
le nettoyage, puis conserve l’identité native lors des refresh suivants.
