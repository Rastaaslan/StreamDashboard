# WizeBot boundary

`WizeBotAdapter` models configuration and provider lifecycle without guessing API
routes. It stays `NOT_CONFIGURED` without an API base URL/token, and reports
`WIZEBOT_TRANSPORT_UNAVAILABLE` when configured without a verified transport.
A tested injected transport can move it to `CONNECTED`.

No scraping, undocumented command endpoint or simulated success is used. A future
transport needs user-provided credentials in secure storage and a verified API
contract before commands, announcements or custom events can be exposed.
