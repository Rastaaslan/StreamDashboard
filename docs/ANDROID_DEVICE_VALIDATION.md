# Android device validation checklist

Run this checklist on the CI APK and a physical Android device before merge.

## Connectivity and resilience

- Pair on a private LAN; verify credential persistence after process recreation.
- Exercise `ONLINE_PC`, `ONLINE_STANDALONE` and `OFFLINE`.
- Disable Wi-Fi during chat, sound playback and planning edits; verify explicit
  offline states, durable queue preservation and recovery after reconnect.
- Revoke the device on PC and verify the existing WebSocket closes immediately.

## Live Control

- Validate real Twitch online/offline transitions without duplicate events.
- Receive chat badges/emotes/replies/bits, send and reply, then test missing-scope
  `NOT_AUTHORIZED` and authorized delete/timeout/ban/unban.
- Page a large chatter list and confirm it is never labelled as viewers.
- Page/open VOD and clips; cancel then confirm a destructive VOD deletion.

## Soundboard, support and automation

- Configure local WAV plus one missing/unsupported file from the PC-only API.
- Play twice with the same command ID; verify one playback and one shared ACK.
- Validate cooldown, stop, missing file, missing output and PC-disconnect messages.
- Confirm UI states that only the system-default output is selectable when
  `supportsExplicitOutputSelection=false`.
- Inspect empty/NOT_CONFIGURED support, then injected test history totals.
- Create/edit/disable/delete an automation and execute test.support → soundboard;
  verify one correlation ID across Event, Automation and Soundboard ACK.

## Diagnostics and presentation

- Filter Events by type, source and correlation ID.
- Rotate screen, background/restore, verify touch targets and bounded scrolling.
- Confirm no token, source path, Authorization header or provider secret appears
  in state, UI, URL, Android logs or diagnostic events.
