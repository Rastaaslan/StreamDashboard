# Discord integrations

The existing Discord bot/planning publication remains unchanged. Local soundboard
and Discord Soundboard are deliberately separate providers.

`DiscordSoundboardProvider` exposes list/play boundaries and explicit
`NOT_CONFIGURED`, `NOT_SUPPORTED` and structured failure paths. The existing bot
token is not automatically reused for voice/soundboard operations: a verified
transport, guild permissions and voice connection lifecycle are required first.
