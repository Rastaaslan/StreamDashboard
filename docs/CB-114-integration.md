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
Since CB-129 the next-seven selection refreshes after startup, hourly, on edits and retries.
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
- `npm test`: 113 Vitest files / 903 tests, plus 140 Node tests (including Chromium UI).
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

## Review iteration 1

The three reproduced issues in `55ca157` are corrected:

- Rolling selection now uses effective overlap (`end > now`, `start < windowEnd`),
  retaining events already in progress until their exclusive end. Regression tests
  refresh and retry both providers at 12:01 for a 12:00–13:00 occurrence after reload.
- CREATE preparation resolves the Google calendar before the durable intent is
  saved. This applies to planning, companion and projected creates. Recovery,
  reads, updates and cleanup use that saved calendar, never a newly selected
  target. A projected journal with no saved calendar fails closed rather than
  guessing. HTTP-level tests inspect the disk checkpoint inside POST, lose the
  response in A, select B, restart and retry/withdraw: only A is ever created and
  its occurrence is cleaned up without an orphan.
- Projection honors each occurrence's effective publication preferences. Google
  preserves those preferences through its input mapping. Editor browser coverage
  verifies both false flags in the occurrence patch; API tests verify suppression
  before CREATE, publication when enabled, withdrawal when disabled, and no
  recreation after restart/retry for both providers.

After correction, `npm test` (898 Vitest + 140 Node), browser (13), mobile smoke,
build, security, shipped-JS, both audits, isolated server smoke and Windows
package/ASAR checks passed again. Desktop smoke was rerun and all four Electron
launches still fail with `Missing X server or $DISPLAY`; no desktop assertion ran.

## Review iteration 2 — Google tombstones

Google keeps deleted event IDs reserved. Logical occurrence identity is therefore
now distinct from its CREATE incarnation: `creationId` salts the deterministic
remote ID while the series identity, occurrence key and logical Google local ID
stay unchanged. Existing links without a creationId retain their original ID.

Confirmed removals keep a compact `projectionRetirements` record with the original
calendar and the next creationId. Explicit reactivation or restoration consumes
that record. Explicit retry of a remotely deleted occurrence first verifies the
old object is gone, then persists a new creationId and CREATE intent before I/O.
The original calendar remains fixed across restart and target-calendar changes.
These retirement records remain with the local series to support later restoration.

A lost response is recovered using the same incarnation, including when a stale
list leads to POST 409 followed by GET of the active event. A confirmed tombstone
settles an old uncertain intent but does not authorize implicit republication.
409 followed by GET 404 remains ambiguous and preserves the original intent;
it cannot mint another ID. Private metadata and conflict resolution also preserve
and validate the incarnation.

The HTTP mock now retains tombstones and returns 409 on reserved IDs. Regression
coverage includes publication/withdrawal/reactivation, exception cancellation and
restoration, remote deletion/explicit retry, restart, lost responses, calendar
changes, recovery of a legacy uncertain tombstoned CREATE, and ambiguous 409/404.
The tests inspect persisted creationId/calendar/intent at the exact POST boundary.

Final validation: 903 Vitest tests, 140 Node tests and 13 browser tests passed.
Mobile smoke, build, security, shipped-JS, both npm audits, isolated server smoke,
and Windows packaging/ASAR gates passed. Desktop smoke was attempted again: four
launch failures due to missing X server/DISPLAY, as permitted by the ticket.

## Review iteration 3 — deletion conflicts and companion tombstones

Google cleanup now persists its deletion intent in the occurrence journal. A 412
keeps the occurrence in conflict; automatic refresh and retry cannot silently
approve a newer remote version. Resolution works from that journal even after
unpublication, cancellation, window expiry or deletion of the companion row.
The adapter re-reads and validates the managed identity, calendar and incarnation.

“Confirmer le retrait” checkpoints the current ETag and explicit deletion decision
before any DELETE. Restart/retry resumes that removal without publishing the
occurrence. Another remote edit requires another explicit decision.
“Conserver l’événement distant” restores a separately linked local event and
suppresses the parent occurrence, preserving ownership tracking without CREATE.
Companion tombstone resolution commits the updated journal and restored row
atomically. Desktop/mobile controls expose both deletion-specific choices,
including companion records that only carry providerLinks.

Regression coverage uses real HTTP 412 responses for withdrawal, cancellation,
window shift and companion tombstone-only deletion, both decisions, disk
checkpoints, restart/retry, a second remote modification and invalid remote
ownership. A mobile regression checks tombstone occurrence resolution controls.

Validation: `npm test` (912 Vitest + 141 Node), `npm run test:browser` (13),
`npm run mobile:smoke`, `npm run build`, `npm run security:check`,
`npm run check:shipped-js`, `npm audit`, `npm audit --omit=dev`, isolated
`npm run smoke`, and `npm run desktop:package` including ASAR checks passed.
`npm run desktop:smoke` was attempted: all four launches fail because this
environment has no X server/DISPLAY; no desktop assertions ran.

One intermediate rerun omitted PLAYWRIGHT_BROWSERS_PATH: its Vitest tests passed,
but Node browser launches failed and the run was interrupted. The final full run
uses the installed browser cache and the writable TMPDIR, as do browser gates.

## Review iteration 4 — legacy native withdrawal and companion ownership

A failed legacy Google native-to-materialized conversion still cannot authorize
an automatic DELETE. Explicit withdrawal instead persists a separate
`nativeWithdrawalRequested` intent before remote I/O. Cleanup retains the original
calendar, ETag and occurrence journal until successful deletion. Restart/retry can
resume this intent without granting projection ownership to legacy events.
The server preserves the intent when loading saved data; companion deletion work
uses the same path. Failed or conflicting cleanup keeps the local row/work.

Companion native CREATE now stores projection ownership and native mode for Google
as well as Twitch, matching PlanningOrchestrator. An exception can consequently
convert a newly owned native Google series into rolling occurrences safely.

Regression tests cover refused automatic legacy conversion, explicit removal with
failure/restart/retry, companion native CREATE followed by exception/conversion,
and companion tombstone cleanup of both owned and legacy links. They assert
calendar/ETag preservation, CREATE counts and absence of remaining remote events.

Validation: `npm test` (915 Vitest + 141 Node), browser (13), mobile smoke,
build, security, shipped-JS, both npm audits (zero vulnerabilities), isolated
server smoke and Windows package/ASAR checks passed. Desktop smoke was attempted;
its four launches fail for missing X server/DISPLAY, the permitted residual.

## Review iteration 5 — native withdrawal conflict decisions

Native Google withdrawal conflicts now have their own resolution path. Both
choices re-read the saved calendar/link and require the current ETag. The local
choice checkpoints the approved DELETE as pending; refresh/retry removes it
without a publication PATCH. An unresolved 412 cannot be retried implicitly.

The remote choice clears the durable withdrawal intent, restores desired Google
publication and records that the native link was deliberately retained. Refresh
and retry preserve that link even if the local rule contains exceptions that
would normally trigger conversion. A subsequent explicit edit/publication or
withdrawal releases this retention. The same retention applies when restoring a
companion tombstone. Server migration preserves this decision across restart.

Four regression cases cover legacy/owned links and both decisions, current ETag
checkpoints, restart, refresh, retry, final explicit removal, and absence of
CREATE/PATCH or remote orphans. An initial global run had one timer-test timing
failure (918 other Vitest tests passed); the complete suite was rerun separately.

Final validation: 919 Vitest tests and 141 Node tests passed, as did 13 browser
tests, mobile smoke, build, security, shipped-JS, both audits (zero vulnerabilities),
isolated server smoke and Windows packaging/ASAR checks. Desktop smoke was
attempted: four launch failures due to missing X server/DISPLAY, as permitted.

## Review iteration 6 — real adapter reads for native withdrawal

The server Google adapter now reads an explicitly withdrawn native object even
when local exceptions make its recurrence unrepresentable as a native RRULE.
This narrowly bypasses recurrence equivalence for the saved withdrawal intent;
normal publication conflict reads retain that guard. Resolution requires the
saved calendar and remote ID, a current ETag, matching managed local identity,
and managed ownership for projection-owned native links.

HTTP/API regressions use the actual adapter for legacy and owned native links,
both decisions, DELETE 412, local exceptions, a changed target calendar, restart,
refresh and retry. They reject foreign managed identities and missing ETags,
inspect the saved calendar/ETag, and verify no PATCH, extra CREATE or orphan.

Validation: `npm test` passed 923 Vitest and 141 Node tests. The final targeted
HTTP regression suite passed all 23 tests. Browser tests (13), mobile smoke,
build, security, shipped-JS, both audits (zero vulnerabilities), isolated server
smoke and Windows packaging/ASAR checks passed. Desktop smoke was attempted:
four launch failures from missing X server/DISPLAY, the permitted residual.
