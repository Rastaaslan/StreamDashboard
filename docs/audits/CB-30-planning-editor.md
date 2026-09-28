# CB-30 — Planning Desktop keyboard stability

## Diagnosis

The event dialog is static, outside `#view`. Normal WebSocket `state.updated`
messages already defer structural rendering while a dialog is open. No runtime
guard disables the title, description, date, time or category fields. Only the
recurrence controls are intentionally disabled for an individual occurrence.
There is no Planning-specific `inert`, pointer-events or tabindex restriction.

Two defects were identified: Alt+1–4 still changed the application view while
editing (reproduced in Chromium), and successful asynchronous saves accessed
`event.currentTarget.reset()` after the event dispatch had ended, when
`currentTarget` is null. Runtime refresh/reconnect also bypassed the existing
render deferral, though the separate dialog DOM survived in the browser test.
The reported complete Windows input failure was not reproduced on Linux Chromium;
these findings do not establish its exact Windows-specific cause.

## Change

All structural render entry points now defer while the Planning dialog is open.
Closing it flushes pending rendering and releases the editing state. Opening an
event focuses its title. Navigation shortcuts are ignored while the editor is
open. The submit handler captures its form before awaiting the save, allowing
reset, refresh and success feedback to complete.

The draft remains in the existing dialog controls; telemetry never populates or
resets them. Explicit open, template selection and recurrence scope changes keep
their existing initialization behavior. Mobile sources are unchanged.

## Verification

`tests/desktop-planning-editor.node.test.mjs` runs the production Desktop renderer
in Chromium with a real local WebSocket and mocked HTTP provider responses. It
covers keyboard title/description input, date/time/category changes, focus and
DOM identity during telemetry/reconnect, required validation, failed save retry,
POST/PUT payloads, concurrent server changes, cancel/reopen, Escape and shortcuts.

Run browser tests with:

```sh
node --test tests/desktop-planning-editor.node.test.mjs tests/desktop-audit.node.test.mjs
```

In the restricted worktree environment, set `TMPDIR=$PWD/.test-tmp` and
`PLAYWRIGHT_BROWSERS_PATH=$PWD/.test-tmp/browsers` (installed using
`npx playwright install chromium`). The default `/tmp` is not writable.

Also checked: `npm run build`, `npm test`, `npm run security:check`,
`npm run check:shipped-js`, and `git diff --check`.
A real Windows/Electron human retest remains necessary to confirm the original
platform-specific symptom is resolved.
