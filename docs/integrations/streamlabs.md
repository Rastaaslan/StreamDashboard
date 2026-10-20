# Streamlabs integration

## Live reception

StreamDashboard connects to the documented [Streamlabs Socket API](https://dev.streamlabs.com/docs/socket-api)
at `sockets.streamlabs.com` using the account's Socket API token. It handles
Socket.IO/Engine.IO heartbeats, received viewer activity and bounded reconnects.
Donation IDs become `streamlabs:<id>`; `SupportRuntime` checks provider + external
ID idempotence before persistence and automation publication.

Socket tokens and history credentials are accepted only from the local PC or an
explicitly paired management client. Electron stores them with Windows
`safeStorage`. They are never returned in API state, HTML, browser caches or logs.

## Account history

Live reception cannot recover events that happened while the source was closed.
The separate **Historique du compte Streamlabs** connection accepts an existing
Streamlabs widget URL (alerts, chat or event list). Only its widget credential is
extracted and stored securely. The submitted URL is never requested or saved;
only HTTPS URLs on `streamlabs.com` or `www.streamlabs.com` are accepted.

The reader makes a GET to the recent-events endpoint used by the official
Streamlabs Desktop application:
`https://streamlabs.com/api/v5/slobs/recentevents/{widgetToken}`.
This is an internal v5 endpoint, not a documented third-party history API. The
implementation is based on the official application's
[recent-events service](https://github.com/streamlabs/desktop/blob/aca8ad9f955779d3ea2160b66f310a6ad1b282a6/app/services/recent-events.ts).
The owner's existing widget credential is sufficient for the observed account;
no first-party OAuth identity, legacy-token exchange or alert replay is used.

The response can contain platform credentials alongside history. Only the
allowlisted donations, subscriptions, follows, raids and bits collections are
normalized into public display fields. Raw payloads, `platforms*`, nested `data`
and `platformcredentials` are never retained. Gift subscribers and their gift
recipients remain distinct; formatted donation amounts are preserved even when
Streamlabs omits the currency field.

Recovery runs at startup, periodically (at most once per minute), on Socket
reconnection and on **Actualiser** (a minimum ten-second cooldown applies).
Concurrent readers share one request. Requests time out after fifteen seconds,
have a two-MiB response cap and honor Streamlabs rate-limit retry delays. A
failed request leaves the last successful history available with an explicit
error and last-sync date. The PC de jeu reads the selected source's merged feed;
its default in a paired workspace is the regie. An explicitly saved source choice
remains respected.

## Dates, merging and retention

Cloud events retain their original occurrence date. The official Streamlabs
[recent-events renderer](https://github.com/streamlabs/desktop/blob/aca8ad9f955779d3ea2160b66f310a6ad1b282a6/app/components-react/editor/elements/RecentEvents.tsx)
interprets timezone-less `created_at` values as UTC; the importer follows that
rule and validates calendar components. Unknown occurrence dates are not
presented as the import time and sort last.

Cloud caches are isolated by widget account, capped at 1,000 events and stored
separately from `streamlabs-events.json`, which retains live reception. The API
merges both and keeps the 1,000 newest known activities. Imports never enter the
support or automation pipeline, so old gifts and donations cannot replay alerts.

Repeated imports use stable event identities. A shared provider `_id` deduplicates
cloud and Socket events; numeric cloud IDs are combined with platform, event
type and original date because some IDs identify viewers. Legacy entries without
a shared event ID are retained separately: names and amounts alone cannot safely
identify the same event. Clearing the history connection stops retrieval and
removes that account's history from the active feed; its separate cache remains
available if the same account is connected again.

The provider determines the depth of history returned. There is no claim that
this endpoint exposes an account's entire lifetime activity or supports archive
pagination. New cloud reads supplement previously cached activity.

## Widget commands

`rollendcredits`, `sessionreset` and `userstatesessionreset` are widget controls,
not viewer activity. They are excluded before normalization and retention, when
reopening saved history, and from old desktop/browser caches. Case, hyphens and
underscores do not change their classification. Other live viewer event types
remain eligible, including events outside the currently supported cloud groups.
