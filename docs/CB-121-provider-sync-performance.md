# CB-121 — provider synchronization performance

Baseline: `6036b7b`. No live account credentials were used. Measurements below use the production provider clients and deterministic simulated HTTP latency, not claims about Twitch/Google production response times.

## Instrumentation and findings

Local-only `GET /api/v1/providers/diagnostics` returns process-lifetime aggregates with fixed provider/phase labels: count, cumulative milliseconds and thrown failures. No IDs, URLs, queries, event content, response/error bodies, calendars or tokens are recorded. Compare snapshots before/after a sync to isolate a run. Metrics are bounded in memory and reset on process restart.

- `http`: physical fetch attempts, including retries; Twitch also counts its non-schedule/auth requests.
- `request-read/create/update/delete`: physical schedule/Google HTTP phases. Non-2xx responses count as attempts; `failed` counts thrown exceptions, not HTTP statuses.
- `identity`: full Twitch schedule / Google recurrence inventory loads, including pagination.
- `reused`: inventory consumers served by the same in-flight or completed read in this pass.
- `read/create/update/delete`: logical rolling operations, including their validation/preflight.
- `rolling`: complete rolling reconciliation, including expansion and persistence.
- `session`: Twitch validation, independently measured. The existing startup/hourly validation and OAuth refresh single-flight remain; no validation was added per occurrence.
- `retry`: cooldown wait time. Shared per client, including concurrent workers.
- `total`: explicit provider Sync and individual rolling passes. These scopes can nest; durations are not additive. Likewise cumulative phase time across concurrent workers is not wall-clock time.

Audit found full inventory reads per CREATE and sequential occurrence processing, plus minute-by-minute global rolling scans. Native Google RRULE stays native. Google recovery inspects the full recurrence inventory because cancelled/detached exceptions may lack private properties. Twitch update fingerprint preflight and Google ownership/ETag reads remain fresh; these reads cannot be dropped safely.

## Controlled before/after

The performance fixture reproduces the baseline's sequential per-occurrence inventory+create loop with the actual clients, then runs the rolling reconciler with the same clients and simulated 100 ms GET / 300 ms POST latency. One-page inventories, empty destination, no OAuth refresh; each provider measured separately. Google fixtures contain an exception to require materialization; an ordinary daily/biweekly rule remains one native RRULE.

| Fixture, per provider | HTTP before → after | Simulated elapsed before → after |
| --- | --- | --- |
| Daily, 28 occurrences | 56 → 29 | 11,200 → 3,100 ms |
| Biweekly, 2 occurrences | 4 → 3 | 800 → 400 ms |

Assertions enforce one inventory read, at most three concurrent requests, and elapsed <65% of the sequential baseline, using virtual time. Reopening persisted identities and retrying creates nothing new. A mixed-provider simple event issues one create per provider and never scans an unrelated rolling series. Partial failure tests retain 27 successes and retry only the failed occurrence. Runtime tests hold the inventory response open to prove startup returns and HTTP remains responsive, then verify overlapping Sync calls share one scan.

## Scheduling and safety

- Three workers process independent occurrence identities. Cleanup completes before publication; native-to-materialized transition remains ordered. Local saves are serialized. Every CREATE intent is durable before network I/O. Its returned identity replaces uncertainty without an intervening yield, including when another worker saves the shared planning.
- Async-local inventory caches belong to one pass/client/account generation (and Google calendar). Errors are evicted. No cache survives a pass or a render. Duplicate Twitch create identities within a pass are reserved, including ambiguous results. Google deterministic IDs and recovery/409 checks remain in use.
- Up to two automatic retries after 429, honoring numeric or HTTP-date Retry-After and a shared cooldown; GET 5xx uses exponential backoff. Existing request deadlines include waits. Ambiguous mutation 5xx/network failures are never automatically replayed. Long cooldowns may outlive a request deadline: subsequent attempts still respect the cooldown. If only definitive 429 responses preceded a deadline, the create intent is released safely for explicit retry. Google disconnect/session invalidation abort both in-flight requests and cooldowns; every HTTP attempt also checks the captured account generation before reusing its Authorization header.
- Initial rolling/companion maintenance is deferred until after server startup. `providersReady` allows tests/callers to await its completion separately. Twitch validation/channel/live reads, Google calendar listing, Streamlabs and WizeBot initialization are also deferred and run concurrently, so provider latency does not delay the return required to create the desktop window. Provider-dependent Twitch actions share the initialization promise; state/static routes and disconnect remain available. Google target selection retains its calendar validation and shares an in-flight calendar listing. Shutdown cancels provider I/O and drains the background startup before returning. Rolling maintenance runs hourly, coalesces overlapping passes, and yields the planning queue between series. Since CB-129 the rolling target is the next seven valid occurrences; automatic renewal can lag by up to one hour. Edits/retries reconcile the requested event immediately.
- Explicit actions can wait for a currently running series, but no longer for all background series. Overlapping full Sync clicks coalesce unless intervening planning work requires a fresh pass. Renderer Sync/Retry controls show feedback before awaiting the HTTP response; existing async transport keeps the renderer responsive.

## Validation

`tests/provider-sync-performance.test.ts` exercises actual clients with simulated latency, relative budgets, Retry-After, safe GET backoff, partial failure, durable identity replacement, restart and simple mixed publication. `tests/provider-sync-startup.test.ts` covers deferred startup, responsive diagnostics and concurrent Sync coalescing. Existing ownership, conflict, uncertain-create, recurrence and UI suites remain applicable. The existing restart review test now awaits deferred maintenance; conflict-read expectations include the two new 503 retries.

Environment: restricted runner requires `TMPDIR=/var/lib/codexbridge/.npm` for direct Vitest/tsx commands and `PLAYWRIGHT_BROWSERS_PATH=/var/lib/codexbridge/.npm/playwright` for browser-backed Node tests. `npm test` manages its own temporary directory.

Final results:

- `PLAYWRIGHT_BROWSERS_PATH=/var/lib/codexbridge/.npm/playwright npm test`: 117 Vitest files / 952 tests and 141 Node tests passed, including browser flows; includes TypeScript build.
- `npm run build`: passed.
- `TMPDIR=/var/lib/codexbridge/.npm npm run security:check`: passed (279 files).
- `npm run check:shipped-js`: passed (31 files).
- `git diff --check`: passed.

Initial direct checks exposed the runner's unwritable `/tmp` and default missing browser path; rerunning with the writable temp/browser cache above resolved these environment failures. Development failures in startup-dependent assertions and retry counts were corrected and the complete suite rerun successfully.


## Review iteration 1

Fixed the reproduced Google DELETE-after-disconnect bug by linking the transport to session cancellation and checking generation before every physical attempt. Fake-time regressions verify immediate cancellation during Retry-After, no second DELETE, and the same guarantee when a concurrent 401 invalidates the session.

Removed the remaining startup awaits for provider network initialization. The connected-provider fixture holds both Twitch validation and Google calendarList responses open, confirms that startup returns and the renderer page remains available, verifies that a Twitch capability action waits for initialization, and that Google target selection can finish independently. A shutdown regression confirms that a pending calendar listing is cancelled without deleting stored credentials. Existing Twitch runtime fixtures now explicitly await `providersReady` before asserting hydrated capabilities, including after restart.

Targeted command: `TMPDIR=/var/lib/codexbridge/.npm npx vitest run tests/provider-sync-startup.test.ts tests/provider-sync-performance.test.ts tests/twitch-runtime-api.test.ts` — 20 tests passed. Full-suite and build/security/syntax/diff results above were rerun for this revision. No live provider credentials were used.


## Review iteration 2

`runPreflight` now awaits the shared Twitch initialization before resolving tags or reading/updating the channel. This covers `session.prepare` from both command endpoints and automations, which do not pass through the Twitch-specific HTTP middleware. The existing immediate `preparing` feedback remains; unrelated state/static requests remain responsive and initialization is not repeated per command.

A connected-startup regression holds OAuth validation pending and submits a preparation requiring a changed title/category through each of `/api/v1/commands` and `/api/commands`. Both cases reproduced a preflight error before the fix. They now verify that preparation waits, sends no early PATCH, succeeds after validation is released with no authorization error, sends exactly one metadata update, and shares the single startup validation.

Targeted command: `TMPDIR=/var/lib/codexbridge/.npm npx vitest run tests/provider-sync-startup.test.ts tests/provider-sync-performance.test.ts tests/twitch-runtime-api.test.ts tests/cb103-integration.test.ts` — 30 tests passed. Full-suite and build/security/syntax/diff results above were rerun for this revision.
