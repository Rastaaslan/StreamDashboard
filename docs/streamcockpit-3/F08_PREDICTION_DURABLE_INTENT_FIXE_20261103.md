# F08 — SQLite creation intent on FIXE (2026-11-03)

## Scope and non-goals
The single OBS-executor FIXE host now records a **per-broadcaster exclusive prediction creation intent** in its own data directory, `streamcockpit-prediction-intents.sqlite`, **before** the only Twitch POST. It supplements the synchronous in-memory fence and never creates a prediction by itself. It uses Node 22 experimental SQLite, rollback journal DELETE and synchronous EXTRA, without exporting secrets, token hashes, prediction options, or viewer data. The journal is lazy: an ordinary unauthenticated or preview-only startup does not create a file.

A confirmed or uncertain Twitch POST leaves its intent blocked **across process restarts**. A separate consent/UUID, even from another request handler, cannot silently reissue a prediction. A definite failure before any POST may explicitly release the journal reservation. A SQLite read/write with unknown outcome fails closed; malformed, foreign, linked and unknown-format journals are rejected. Existing databases are examined before writable journal pragmas to avoid mutating an unrelated DB. No implicit migration and no deletion of user data.

## Qualification evidence
- FIXE Windows 11, isolated temporary NTFS SQLite test folders and simulated provider; six SQLite regression scenarios: confirmed and uncertain restart, pre-POST failure, independent service owners/contended reservation, corrupt file, foreign WAL/format unchanged, and uncertain DB write without Twitch POST.
- Existing F08 preview/confirm HTTP tests **14/14 PASS**, roadmap **3/3 PASS** and real Edge touch **320 px 4/4 PASS** (opt-in) with simulated provider. No actual Twitch or OBS production command was issued. TypeScript, browser types, security (867 files), development build (133 assets), shipped JS syntax (140 files) and built Node suite **349 PASS / 6 skipped / 0 FAIL** passed after the last source edit.
- Full Vitest source suite was run once **before** the final existing-database preflight hardening; do not attribute that earlier run to later edits without a rerun. The narrow Windows SQLite + HTTP tests and TypeScript/security were repeated after that edit.

## Remaining design gates
There is **no qualified explicit reconciliation** with a real Twitch current/last prediction identity and no safe unblock-after-resolution UI. A confirmed prediction still blocks all future creation for that channel until such a workflow exists. A legacy prediction possibly created before this schema is not automatically discovered. SQLite EXTRA is a software barrier, **not a measured power-loss/disk-controller durability guarantee**. No atomic transaction exists across OBS, SQLite and Twitch. Node 22 node:sqlite is experimental; directory access control, backups, restoring after failure, physical Android/laptop/FIXE, production OAuth and actual OBS/Twitch are untested.

G2 is still in progress; G3–G5 remain open. No Windows EXE, Android APK, signed release, production installation or public stream action.
