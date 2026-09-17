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
