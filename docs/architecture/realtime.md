# Realtime transport

The authenticated `/ws/v1` transport retains its same-origin checks and its
short-lived, single-use ticket for LAN devices. Connections first receive
`server.ready` and a redacted `state.updated` snapshot. Runtime domain events are
then delivered additively as `event.received` envelopes. Existing clients can
ignore the new message type safely.

REST remains appropriate for initial snapshots, resources and bounded history:

* `GET /api/v1/state` — compatibility snapshot;
* `GET /api/v1/control-hub` — aggregated mobile cockpit snapshot;
* `GET /api/v1/events` — bounded diagnostics with exact type/source/correlation
  filters;
* `POST /api/v1/commands` — established command adapter.

The current `state.updated` full snapshot is intentionally retained until every
existing client has proven delta coverage. New low-volume domain events avoid
expanding it. LAN routes still pass device authentication and remote allowlists;
credentials and tokens never appear in URLs or events.
