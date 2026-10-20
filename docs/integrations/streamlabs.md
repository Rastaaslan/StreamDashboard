# Streamlabs support provider

StreamDashboard connects to the officially documented Streamlabs Socket API at
`sockets.streamlabs.com` using the user's Socket API token. The implementation
speaks the Socket.IO/Engine.IO websocket framing used by that API, responds to
heartbeats, consumes `event` packets of type `donation`, and closes cleanly.

The token is accepted only by a loopback-only configuration route and is stored
by `ElectronSecretStore` (Windows `safeStorage`). It is never returned in state,
mobile payloads, HTML, or logs. Disconnects move the provider to `DEGRADED` and
trigger a bounded reconnect; explicit disconnect cancels it.

Donation IDs become `streamlabs:<id>`. `SupportRuntime` enforces provider +
external ID idempotence before persistence and automation publication. The local
test route creates an explicitly marked `[TEST]` support without contacting the
donation service.

## Activity history

The Socket API activity feed records received viewer events across Twitch,
YouTube and Streamlabs. Widget controls `rollendcredits`, `sessionreset` and
`userstatesessionreset` are excluded; case, hyphens and underscores do not change
that classification. This applies before normalization and retention, when
reopening saved history, and to old desktop/mobile caches. Other valid event
types remain eligible, including future viewer events.

The last 1,000 received activity events are retained by each source. Widget
commands cannot evict viewer events. Previously saved commands are removed when
the source reopens its history; valid entries keep their identifiers and dates.
This is a received-event history, not a fetch of the full Streamlabs account
history: periods before the source connected are not reconstructed.
