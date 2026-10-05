# CB-126 — daily rolling checkpoint amplification

Base: `1546d3e1375c86d5117bcd4fd14f27cff6745418` (CB-125). Scope: the Twitch daily/1 HTTP lifecycle and shared rolling persistence. No timeout changes.

## Reproduction and cause

Runner: Linux, Node v24.21.0; no Windows runner is available here. Native Windows timing remains to be confirmed by CI. The Windows failure reported in the ticket is consistent with the reproduced disk-latency sensitivity below; these measurements are not presented as a Windows trace.

The exact test creates 28 daily occurrences, stops/restarts the actual server, awaits `providersReady`, retries, edits and deletes the series. Every checkpoint uses real `AtomicJsonStore.write`: clone, serialized temp-file write, fsync, close and rename. CB-121 already runs three remote workers concurrently and shares the create inventory, but the projection wrapper queued a separate full durable write for every worker checkpoint. It also saved pending creation immediately before the durable CREATE intent and saved every unchanged occurrence on restart/retry. Result: **242 durable writes** for the lifecycle, including teardown.

With diagnostic `CB126_DISK_MS=16` adding 16 ms to each real store write, the original implementation reproduces the **5000 ms timeout** (202 writes / 4263 ms accumulated persistence at interrupted cleanup; the lifecycle did not finish). This models slow storage, not Windows itself. Without injected latency the original test passes in 1689 ms. The new write-count assertion, applied to the original implementation, independently fails: **241 > 112**, before the teardown write.

## Fix and safety

- Checkpoint requests queued before a snapshot starts share that snapshot's completion. The queue slot is cleared **before** calling save: requests arriving during disk I/O require the next snapshot. There is no debounce timer.
- New entries rely on the existing durable CREATE-intent checkpoint instead of an extra pending-only save. No CREATE can precede its durable intent.
- Unchanged successful reads refresh local tag metadata and use the final summary checkpoint. Remote identity changes, errors, conflicts and mutations retain their checkpoints.
- Each worker still waits for its returned identity to become durable before advancing. Persistence failures reject the waiting work; no queued CREATE is released. Writes remain serialized; remote concurrency remains three.
- Ownership, uncertain-create protection, conflict reads, identity reservation, retry/backoff and rate-limit transport are unchanged.

CB-121/CB-122 interaction: `providersReady` intentionally includes the initial rolling maintenance. The fixture already awaits this explicit signal, including after restart; it does not poll or sleep. Removing that wait would weaken restart coverage. Startup's zero-delay deferral, maintenance's per-series `setImmediate`, hourly maintenance/validation and 30-second live polling remain unchanged. The successful lifecycle has no retry/cooldown waits and uses real timers; fake timers are only used by the isolated checkpoint/transport unit tests. The optional diagnostic disk delay is never enabled by default.

## Measurements

Representative full traces, milliseconds rounded. Before is the original production implementation with the instrumented fixture (the new count assertion fails at the end); after is normal repetition 3. Phases overlap: rolling contains storage/provider work, so rows must not be added together. HTTP route timings include response generation; the test also reads dashboard snapshots and checks persisted state.

| Phase | Before | After |
| --- | ---: | ---: |
| Initial bootstrap / stop | 25 / 6 | 24 / 6 |
| Connected startup, two starts | 12 | 12 |
| Twitch auth/session init, two validations | 4 | 4 |
| `providersReady`, two waits including restart rolling | 69 | 16 |
| HTTP create | 437 | 411 |
| Stop before restart | 7 | 8 |
| HTTP explicit retry | 240 | 205 |
| HTTP edit | 336 | 312 |
| HTTP delete | 97 | 42 |
| Rolling reconciliation, five passes over 28-day horizon | 478 | 181 |
| Create inventory, one list | 0.6 | 0.6 |
| Provider creates, 28 logical calls | 13 | 20 |
| Provider reads, 84 logical calls | 13 | 25 |
| Provider updates, 28 logical calls | 13 | 10 |
| Provider deletes, 28 logical calls | 3 | 6 |
| Durable persistence | 242 calls / 485 ms | 85 calls / 183 ms |
| Final server teardown | 2 | 2 |

Provider HTTP counts before/after are identical: 2 OAuth validations, 2 channel reads, **113 schedule GETs, 28 POSTs, 0 PATCHes, 28 DELETEs**. Schedule GETs comprise one shared create inventory (27 cache reuses), 28 restart reads, 28 retry reads and 56 edit/conflict reads. The description-only edit invokes 28 logical updates but Twitch sends no PATCH because its schedule fields did not change. Those conflict checks were deliberately retained.

Normal post-fix repetitions: **2799, 1555, 1580, 1435, 1579 ms** (first run overlapped the full suite). Three repetitions with 16 ms added per durable write: **3010, 3121, 3033 ms**, all passing the original 5-second limit, each with 85 writes. The second slow-disk run measured 1683 ms persistence, 1498 ms rolling, 42 ms providersReady, 1108/249/719/312 ms create/retry/edit/delete and 19 ms teardown.

## Validation and reproduction commands

Prefix direct Vitest commands in this restricted runner with `TMPDIR=/var/lib/codexbridge/.npm`. To emit the phase/call report, add `CB126_TRACE=1` and `--disableConsoleIntercept`; optionally add `CB126_DISK_MS=16` to reproduce slow durable storage. No credentials or live provider services are used.

- `npx vitest run tests/cb122-recurrence-runtime.test.ts -t 'twitch HTTP lifecycle daily/1 simple' --disableConsoleIntercept --reporter=verbose`: 5/5 normal and 3/3 slow-storage repetitions passed.
- `npx vitest run tests/cb122-recurrence-runtime.test.ts tests/provider-sync-performance.test.ts tests/provider-sync-startup.test.ts`: **71 tests passed**. Includes new durable ordering, bounded write count, restart idempotence and failed-checkpoint regressions, plus existing ownership, ambiguous responses, retry and rate-limit coverage.
- `PLAYWRIGHT_BROWSERS_PATH=/var/lib/codexbridge/.npm/playwright npm test`: **121 Vitest files / 1021 tests and 160 Node tests passed**, including browser tests and TypeScript build.
- `npm run build`: passed.
- `git diff --check`: passed.

Initial test launch failed because dependencies were absent; `npm ci --ignore-scripts` installed the lockfile dependencies. The intentional pre-fix slow-storage timeout and pre-fix count-assertion failure are reproductions, not remaining failures.
