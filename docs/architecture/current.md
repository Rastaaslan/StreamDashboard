# Current architecture

StreamDashboard is one deployable application with three presentation surfaces:
Android/mobile (primary control plane), desktop web (secondary), and the Electron
shell. Both UIs consume the Node PC Runtime. The runtime composes shared domain
services and provider adapters; Electron adds lifecycle and secure native secret
storage but has no privileged business workflow.

```text
Android/mobile ─┐
Desktop web ────┼─ REST + WebSocket ─ PC Runtime ─ OBS / Twitch / Google / Discord
Electron shell ─┘                         │
                             core contracts, events and actions
```

Authority is deliberately not centralized on Android. OBS remains authoritative
for scenes, streaming and local audio. Providers remain authoritative for their
resources. StreamDashboard owns planning, checklist, templates, timer and sync.
See [the audited baseline](night-run-baseline.md) for routes and existing debt.

The current migration is additive. `/api/v1/state` and `state.updated` remain the
compatibility path, while `/api/v1/control-hub`, `/api/v1/events` and
`event.received` expose the new domain-oriented control plane.

Twitch Live Control now uses real Helix resources for live status, viewer count,
chatters, VOD and clips, plus EventSub WebSocket for chat. Android consumes these
through authenticated runtime routes; Twitch credentials never leave the PC.

The composition root now delegates sound playback, automation persistence/execution
and support history to `SoundboardRuntime`, `AutomationRuntime` and
`SupportRuntime`. Provider-specific boundaries live below `integrations/`.
