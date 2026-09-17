# Night Run baseline — 2026-09-16

## Repository map and authority boundaries

StreamDashboard is a TypeScript monorepo shipped as an Electron application. The
Electron main process starts the same Express/Node **PC runtime** that can also be
started with `npm start`. The browser desktop UI (`apps/web`) and the Android
WebView/PWA UI (`apps/mobile`, wrapped by the Gradle project in `android`) are
clients of that runtime; there is no React application in the current tree.

| Area | Current implementation | Authority |
| --- | --- | --- |
| PC runtime | `apps/server/src/index.ts` | orchestration, REST/WS, persisted state |
| Desktop shell | `apps/desktop/src` | lifecycle, secure secrets, window and OBS launch |
| Desktop UI | `apps/web` | local runtime client |
| Android/mobile | `apps/mobile` + `android` | primary remote UI, durable companion data |
| Shared contracts/core | `packages/contracts`, `packages/core` | wire types and provider-neutral rules |
| Integrations | `integrations/*` | OBS, Twitch, Google Calendar, Discord adapters |
| Resilience | `packages/resilience` | bounded retry primitives |

The authority remains domain-specific: OBS owns live/scene/audio state; Twitch
owns channel metadata and schedules; Google and Discord own their remote
resources; StreamDashboard owns planning, checklist, timer, companion journal
and conflict decisions. Android is a control plane, not a replacement authority.

## Backend, storage and jobs

`createDashboardServer` in `apps/server/src/index.ts` composes the application.
It uses Express 5, `ws`, an atomic versioned JSON store, and an Electron-backed
secret store in production. Background work is deliberately in-process: timer
expiry, serialized planning/settings operations, provider refresh/retry, remote
activity persistence, and unplanned-live tracking. There is no queue server,
SSE transport, SQL database, or cloud service.

Authentication has two trust zones. Loopback clients are local administration
clients. LAN clients pair using a one-time code, receive a per-device credential,
and exchange that credential for a short-lived, single-use WebSocket ticket.
Remote state is explicitly redacted and remote commands use an allowlist.

Persistence is schema-versioned and written atomically. Companion sync retains a
canonical `serverRevision`, global cursor, operation IDs, idempotence journal,
tombstones, validation, prototype-pollution protection and explicit conflict
resolution. Those mechanisms are migration constraints, not refactor targets.

## Important API inventory

All `/api/v1` routes are retained. Legacy `/api` aliases adapt to the same
handlers where present.

| Method/path | Auth | Consumer/domain | Side effects / coverage |
| --- | --- | --- | --- |
| `GET /api/v1/state` | local or paired | all clients/dashboard | redacted remotely; API and remote tests |
| `POST /api/v1/commands` | local or paired + allowlist | all clients/OBS, timer | serialized runtime command; command/API tests |
| `POST /api/v1/remote/pairing` | local only | desktop/pairing | creates expiring code; remote tests |
| `POST /api/v1/remote/pair` | one-time code | Android/pairing | creates device credential; remote/Android tests |
| `POST /api/v1/remote/ws-ticket` | paired | Android/realtime | creates single-use ticket; security tests |
| `POST /api/v1/companion/sync` | paired | Android/companion | reconciliation, revisions and conflicts; sync tests |
| `POST/PUT/DELETE /api/v1/planning...` | local or scoped paired | desktop/mobile/planning | provider-aware mutation; planning tests |
| `GET/POST /api/v1/twitch/...` | route-specific | desktop/mobile/Twitch | categories, metadata, OAuth/sync; Twitch tests |
| `/api/v1/google/...` | local only | desktop/Google | OAuth and calendar operations; API tests |
| `/api/v1/discord/...` | local or narrowly scoped paired | desktop/mobile/Discord | configuration/publish; Discord tests |
| `GET /api/v1/diagnostics` | local only | desktop/diagnostics | reads runtime health only; audit tests |

Payload limits are 32 KiB generally and 14 MiB only for Discord planning image
publication. IDs, strings, recurrence fields and provider links are validated.

## Realtime baseline

`/ws` and `/ws/v1` are the only realtime transports. On connection the runtime
sends `server.ready`, then `state.updated`. Mutations broadcast another complete
state snapshot. LAN sockets require a single-use ticket and are terminated when
their device is revoked. The mobile transport reconnects and restores cached
companion state. There are no command ACK envelopes, event cursor, SSE listener,
or domain deltas yet; full-state broadcast is the principal scaling debt.

## Desktop/runtime boundary

The runtime is already independently startable and owns OBS/integrations. The
desktop shell owns only capabilities intrinsically local to packaging: process
lifecycle, native secrets, window security, update and optional OBS launch. The
largest remaining coupling is composition: `apps/server/src/index.ts` contains
route registration, provider orchestration, state projection, persistence and
background jobs in one module. Extraction must be incremental to avoid changing
security middleware ordering.

## Android/mobile baseline

Android is a native WebView wrapper with a bridge for secure credentials and
provider hand-offs. The mobile application is framework-free modules. It has
five touch-oriented views, transport abstraction, reconnect logic, versioned
storage, durable operation queue, provider sync, cached planning/checklist/notes/
templates, and the three modes `ONLINE_PC`, `ONLINE_STANDALONE`, `OFFLINE`.
Remote-only OBS controls are disabled clearly when the PC is unavailable.

## Technical debt and incremental plan

* The server composition root mixes transport, domains and integrations.
* Realtime sends whole snapshots for every mutation and has no normalized event
  envelope, bounded diagnostics stream, correlation, or explicit command ACK.
* Provider health uses heterogeneous booleans/errors rather than one lifecycle.
* Errors have a partial structured contract but no shared retryability field.
* Twitch channel operations are adapter-backed, but live/chat/audience/VOD/clips
  domains and corresponding mobile surfaces do not exist.
* `apps/web/app.js` and `apps/mobile/mobile.js` duplicate presentation behavior;
  shared wire contracts exist, but browser JavaScript cannot consume every
  TypeScript type directly.
* OBS “Fun Deck” restarts OBS media sources; it is not a local audio soundboard
  and must not be represented as one.

The safe first slice is therefore: shared event/action/integration contracts,
provider-neutral core services with tests, additive REST snapshots and realtime
events, then an Android-first cockpit consuming those contracts. Existing V1,
state broadcasts, companion sync, and desktop behavior remain compatibility
paths until their replacements have equivalent integration coverage.
