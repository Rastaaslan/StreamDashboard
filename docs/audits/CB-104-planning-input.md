# CB-104 — Concurrent Planning editor openings

Baseline: `d763dc0`. The existing Desktop keyboard test passes on this baseline.
The additional browser scenario fails: double-click **Ajouter** while the initial
`/api/v1/companion/snapshot` request is pending, complete the first response, click
the title and type, then complete the second response. The title becomes empty.
The regression reports expected `Saisie pendant le chargement`, received `""`.

`openEventDialog()` awaited templates before opening the modal, allowing multiple
click handlers to enter. Every response then called `populateEventForm()`, whose
`form.reset()` erased the active draft and reassigned `state.eventEdit`. This
affects the shared creation/edit opening path, independently of telemetry.

The fix reserves the opening before awaiting the request and rejects further
opens while loading or while the modal is open. `finally` releases the reservation,
including on errors. Explicit duplication and recurrence scope changes retain
their existing form population behavior.

Audit: the dialog is static outside `#view`; render deferral and the modal keyboard
shortcut guard are already present. Title/description/date/time fields have no
`disabled` or `readOnly` guard. Recurrence is disabled for individual occurrences;
publication checkboxes depend on provider capabilities. No CSS pointer-events or
Electron draggable region blocks these fields. The browser records no uncaught
runtime errors during the passing scenario. This reproduces a concrete loss of
input under concurrent opening; a permanent Windows-only input freeze was not
reproduced or verified on Windows.

Validation (Linux Chromium, real clicks and keyboard input, local WebSocket,
mocked HTTP responses):

- `TMPDIR=$PWD/.test-tmp PLAYWRIGHT_BROWSERS_PATH=$PWD/.test-tmp/browsers node --test tests/desktop-planning-editor.node.test.mjs tests/cb52-planning.node.test.mjs tests/desktop-audit.node.test.mjs`: 7 passed. Includes creation, editing, failed-save retry, cancel/reopen, telemetry/reconnect, tags, and saving a duplicate with modified recurrence.
- `TMPDIR=$PWD/.test-tmp npx vitest run tests/recurrence.test.ts tests/tags-integration.test.ts tests/planning-conflict.test.ts tests/desktop-product-v2.test.ts tests/desktop-runtime-assets.test.ts`: 29 passed in 5 files. The initial invocation without `TMPDIR` could not create Vitest's `/tmp` directory; rerunning with the writable worktree directory passed.
- `npm run build`: passed.

Install Chromium with `PLAYWRIGHT_BROWSERS_PATH=$PWD/.test-tmp/browsers npx playwright install chromium` if needed. Temporary assets are not part of the change.
