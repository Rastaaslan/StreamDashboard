# Recurrence V2 and Google projection

Origin: CB-113 on f4d3b2b; final runtime integration is documented in CB-114-integration.md.

`RecurrenceRule.version` is optional: absence means V1 (daily/weekly/monthly,
interval 1 or 2). `migrateRecurrence` returns a cloned V2 rule,
preserving until, exceptions and engine parameters; repeat migration is safe.
There is no destructive store rewrite or global schema bump. Existing records
remain readable. V2 admits positive integer intervals; an opaque `custom` payload
has its own engine name, version and parameters (for example multiple weekdays).
Unknown rule versions fail closed. Server and companion accept V2 base rules and
reject custom writes until a corresponding engine/editor is installed.

`OccurrenceSource` and `RecurrenceProjection` form the generic rolling-core seam.
`projectGoogleSeries` prefers native RRULE when the mapping is exact, including
V2 interval N. Otherwise rolling synchronization requests the next seven valid occurrences (CB-129); explicit calendar/export windows remain supported.
The default core engine applies until and exceptions. A custom engine must do the
same, returning canonical stable keys even when an exception moves an occurrence.
Unknown custom engines fail; they are never approximated using the base frequency.
The planner rejects duplicate keys, invalid dates and out-of-window output.

The returned entries distinguish `master` from `materialized`, with a stable
series local identity and, for materialized entries, an occurrence key. Google
private properties preserve those identities. Each occurrence has a distinct,
deterministic local ID and Google create ID. Retry recovers a lost response;
identity/content mismatches require reconciliation. Updates and deletion through
`deleteProjected` require the saved occurrence etag and retain Google 412 conflicts.
A cancelled remote create is not recreated implicitly with a new identity.

CB-114 connects this planner to `PlanningOrchestrator` and the shared durable
provider reconciler. It refreshes both providers on startup, every 60 seconds,
on edits and explicit retries. Each owned occurrence stores its calendar, remote
identity and etag independently. Obsolete owned links are cleaned up before a
materialized-to-native transition. Native links with unknown ownership require
explicit withdrawal; unrelated remote events never enter the owned inventory.

## Window and DATE semantics

Window membership is evaluated after applying an exception's replacement dates.
An occurrence moved out of a window is omitted; one moved into it is included,
including when its original anchor is later than the window. Exception anchors
are checked against the cadence directly, retaining the original occurrence key.
`until` still constrains the original anchor (inclusively): a valid occurrence may
move beyond until, but an exception cannot create an anchor beyond until.

Materialized all-day events require both endpoints at UTC midnight and a positive
exclusive date range. These are exactly the instants returned by Google's DATE
serialization. Non-midnight endpoints, including those introduced by a non-UTC
series crossing DST, are not rounded or truncated: the entire plan fails before
mutation. The client repeats this check for direct materialized create/update
calls. UTC all-day occurrences and non-UTC occurrences that are exactly DATE
representable keep stable retry comparisons after a lost create response.
