# Support, audience and automation foundations

The provider-neutral `Support` model stores integer minor units and ISO currency,
and deduplicates by `(provider, externalId)`. Provider deliveries therefore yield
one business record before any future alert or automation is emitted. There is no
Streamlabs connection in this slice; UI/runtime report `NOT_CONFIGURED` honestly.

Audience snapshots keep `viewerCount` distinct from `chatters`. A chat roster is
never described as a viewer list and no watch duration/presence is inferred.

Automation matching supports an enabled flag, one event trigger, simple AND
conditions (`eq`, `gte`), sequential action descriptions and a cooldown. It only
matches normalized events; it never calls provider APIs directly. Execution and
persistence adapters are intentionally separate. `AutomationEngine` now consumes
domain envelopes, serializes runs, executes actions sequentially, propagates the
event correlation ID, records `lastExecutionAt`, applies cooldown and stops a
sequence on its first failure. The support→soundboard production path remains
blocked until both a configured SupportProvider and real PC audio adapter exist.

Rules are now durably persisted with create/edit/enable/delete APIs and an Android
editor. Last execution and last result/error are retained. The local Soundboard is
a real ActionProvider, and the test-support event exercises the complete Event →
Automation → ActionCore → PC audio → ACK chain. Streamlabs live ingestion remains
external-transport blocked, while stored support history and aggregates are usable.
