# Mobile-first control plane

Android is the preferred user interface, not the universal data owner. The Home
screen now aggregates live status, separate viewer/chatter metrics, runtime and
provider health, recent activity, OBS state and quick live controls. It delegates
all behavior to existing transport/domain modules.

`ONLINE_PC`, `ONLINE_STANDALONE` and `OFFLINE` are preserved. Planning, notes,
checklist and templates retain their versioned cache, durable operation queue,
revisions, tombstones and explicit conflicts. OBS and other PC-local controls are
disabled with a “PC hors ligne” explanation instead of presenting network errors.

Unavailable capabilities are explicit. A null viewer count means “not supplied”;
it is never derived from chatters. Streamlabs, WizeBot and local soundboard remain
`NOT_CONFIGURED` until a real authenticated adapter exists. No provider secret is
moved to Android.

When Twitch is connected with the required scopes, the Home tools provide real
chat, audience, paginated VOD and clips. Sending chat waits for the Helix response;
VOD deletion requires a typed destructive confirmation; clip creation reports
Twitch's accepted/processing state. These tools clearly require the PC Runtime and
show “PC hors ligne” instead of attempting to store Twitch credentials on Android.
