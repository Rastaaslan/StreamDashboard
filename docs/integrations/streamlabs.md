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
