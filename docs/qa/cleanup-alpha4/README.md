# Cleanup alpha.4 — 2026-10-22

Implementation and post-change audit for Windows host/controller and Android. Evidence is in findings.json, evidence.json, artifacts.json and source-manifest.json. Reproduce browser metrics with browser-probe.mjs, production offline checks with production-offline.mjs, and module sizes with structure.mjs after npm run build.

## Compatibility and packaging

The default manifest retains the current control shell, native executor, timer overlay and the old Windows cockpit. Old mobile UI and previews remain in source. Build with SD_INCLUDE_LEGACY_UI=1 npm run build for a compatibility profile; use the same environment for android:sync. Full historical feature parity is not claimed. Do not remove the remaining legacy code before notes, preparation/diagnostics and editorial preferences have acceptance coverage.

## Gates

Vitest: 1477/1477; Node: 354 unique tests verified across full run and targeted recovery; browser: 119 unique scenarios verified; Android JUnit: 49/49; Android lint: 0 errors, 15 warnings. TypeScript, incremental checkJs, syntax, security and EXE/ASAR integrity pass. Desktop native smoke is unqualified without X display. No physical phone was available. 75 qualification matrix cells remain pending. No deployment to the user's Windows installations was performed in this task.

## Further work

Continue splitting server/control/provider responsibilities; extend checkJs gradually; define safe receipt compaction with a replay floor; finish historical UI parity. Validate native encrypted receipt migration, suspend/resume and accounts on a real phone. Keep data backups before downgrade from IndexedDB schema 3.
