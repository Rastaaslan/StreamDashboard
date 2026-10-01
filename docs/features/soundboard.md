# Local Soundboard

The soundboard belongs to the PC Runtime. Its persisted catalog stores stable ID,
name, category, local source path, favorite, volume, cooldown, enabled state and
output ID. Source paths are removed from remote snapshots; Android only receives
`sourceAvailable`.

The runtime exposes `supportsExplicitOutputSelection`. It is currently `false`
for PowerShell SoundPlayer, `afplay` and `ffplay` in this dependency-free adapter,
so only `system-default` is advertised as selectable. A non-default ID is rejected
with `AUDIO_OUTPUT_UNAVAILABLE`; the runtime never pretends to route a device.

`SystemAudioPlayback` is the OS adapter. It uses a child process without a shell:
PowerShell `System.Media.SoundPlayer` on Windows, `afplay` on macOS and `ffplay`
on Linux. The portable backend currently routes only to `system-default`; other
detected/configured output IDs are rejected rather than silently playing on the
wrong device. Windows playback is WAV-only in practice and unsupported formats or
missing player binaries return a failed ACK.

The command flow is Android → authenticated REST → `ActionCore` →
`SoundboardRuntime` → `AudioPlayback` → ACK. Android reports success only after a
`succeeded` ACK. Duplicate command IDs return the stored ACK, cooldown begins only
after confirmed playback, and missing file/output/format/device errors use stable
codes. Catalog configuration including local paths remains local-PC only.
