# CB-114 — final rolling recurrence integration

Base: `f4d3b2b`. Local integration only; no merge, push or deployment.

## Comparative decisions

| Source | Retained | Replaced or completed |
| --- | --- | --- |
| CB-110 `fe28d07` | Confirmed native withdrawal, remote recurring flag reset, durable failure/retry identity; definitive CREATE failure is not a remote deletion. | Partial weekly publication is rejected. Until/exceptions use exact rolling occurrences instead of a remote infinite series plus a cleanup timer. |
| CB-111 `791f50c` | Indexed wall-clock projection, direct window seeking, DST gap/fold disambiguation, original-anchor until, stable keys and provider-neutral reconciliation contracts/tests. | Its occurrence generator lives in the browser-safe shared module; the TypeScript facade delegates to it. Existing UI IDs/series references remain compatible. |
| CB-112 `e019ebe` | Twitch 28-day journal, per-operation persistence, owned-only cleanup, companion/retry integration, native transition recovery and per-occurrence conflict choices. | Durable rolling execution is shared with Google. Periodic refresh, Google companion cleanup and desktop occurrence conflict controls are added. |
| CB-113 `a5d266f` | Versioned rules/custom seam, lossless Google RRULE, materialized identities, deterministic Google IDs, etag guards, moved exceptions, all-day validation. | The second historical scan is replaced by CB-111's seeking algorithm. The projection seam is connected to the real orchestrator, server timer, retry, import filtering, conflict resolution and withdrawal. |

## Canonical model and behavior

`apps/mobile/shared/recurrence.js` is the only occurrence generator, re-exported by
core and used by server, desktop and mobile. Keys use the durable local identity
and nominal wall-clock anchor, even when an exception moves an occurrence.
Window membership uses effective dates; until is inclusive on the original anchor.
Monthly dates clamp to the last day. DST gaps move forward; folds choose the first
instant. Duration remains elapsed UTC time.

Legacy rule objects remain unchanged during display. Explicit migration clones a
rule into V2 without losing exceptions, until or timezone. Historical interval-2
shapes remain readable. V2 admits arbitrary positive intervals and an opaque
versioned custom-engine payload. Unknown custom engines fail before provider I/O;
the editor and API do not yet authorize custom rules.

`provider-projection.ts` owns one shared durable rolling journal. The Twitch and
Google modules select exact native representation or supply canonical occurrences.
The 28-day window refreshes at startup, every 60 seconds, on edits and retries.
Each successful write saves its identity before the next operation. Google keeps
calendar/etag per occurrence; Twitch keeps fingerprint and durable CREATE intent.
Remote import does not add owned projected events as independent planning items.

Twitch weekly-1 without until, exceptions or custom clauses remains native.
Other supported rules materialize one-off segments. Removing a managed native
rule does not silently convert the remote series: confirmed withdrawal clears its
remote recurring state before publication as a one-off. An unknown/legacy native
ownership link requires explicit withdrawal before conversion.

Google exact mappings remain native RRULEs; exceptions and non-exact/custom
sources use projection. Private identities and deterministic remote IDs recover
lost CREATE responses. Etag conflicts require an explicit local/remote choice,
including on restart. Materialized DATE events require UTC-midnight boundaries;
unsafe all-day ranges are rejected rather than truncated.

Bulk deletion preserves the existing protected-series policy: canonical series
and projected journals are excluded, even when their anchor predates the period.
Individual series deletion drains every owned occurrence before removing local
state. Companion tombstones retain both providers' journals on partial failure.
Retries preserve other providers and unresolved occurrence conflicts.

## Validation

Commands used the writable temporary/cache directories below where required:

```
TMPDIR=/var/lib/codexbridge/.npm/cb114-tmp
PLAYWRIGHT_BROWSERS_PATH=/var/lib/codexbridge/.npm/playwright
electron_config_cache=/var/lib/codexbridge/.npm/electron
ELECTRON_CACHE=/var/lib/codexbridge/.npm/electron
```

- `npm ci --cache /var/lib/codexbridge/.npm`: success, 0 vulnerabilities.
- `npm test`: 112 Vitest files / 893 tests, plus 140 Node tests (including Chromium UI).
- `npm run test:browser`: 13 passed.
- `npm run mobile:smoke`: passed, LAN auth/pairing/redaction/WS/revocation.
- `npm run build`: passed (also run by test and desktop package).
- `npm run security:check`: passed.
- `npm run check:shipped-js`: 31 files passed.
- `npm audit` and `npm audit --omit=dev`: 0 vulnerabilities each.
- `npm run smoke`: passed against an isolated server started on an ephemeral port.
- `npm run desktop:package`: Windows x64 package and ASAR checks passed.
- `npm run desktop:smoke`: attempted after installing Electron; all four launches
  stop with `Missing X server or $DISPLAY`. No Xvfb is installed in this runner.
- `git diff --check` / `git diff --cached --check`: checked before local commit.

The focused cases cover daily/biweekly/monthly, native weekly and bounded weekly,
cancel/patch, DST gaps/folds, until, moved exceptions, window shifts, restart,
retry, lost responses, unowned remote events, Google native/fallback, etag
conflicts, period-delete protection, companion deletion and legacy migration.

Initial runs exposed missing browser/Electron caches and an unwritable `/tmp`;
these were rerun using the cache paths above. Integration failures were corrected
before the final suites. The server smoke requires a running server; its first
standalone invocation was rerun against the isolated test server.

## Remaining operational limits

- Twitch offers no idempotency key. An ambiguous CREATE stays blocked with a
  durable intent instead of risking a duplicate; identity reconciliation is needed.
- Rolling coverage advances while StreamDashboard is running and connected.
- Google all-day rules that cannot round-trip exactly remain actionable errors.
- Custom rule types and injection seams exist; no custom editor/engine ships here.
- Live provider credentials were not used; provider interactions use contract mocks.
- Native desktop UI execution remains unverified in this headless environment.
