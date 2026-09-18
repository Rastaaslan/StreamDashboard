# WizeBot boundary

WizeBot is no longer advertised as unsupported. `WizeBotAdapter` is wired to an
HTTP transport and exposes configuration, authentication validation, refresh,
account name, bot connectivity, disconnect, and explicit lifecycle errors.

WizeBot deployments/accounts can provide different API resources. To avoid
inventing an endpoint, StreamDashboard sends a GET to the complete HTTPS status
resource supplied by WizeBot and does not append a path. Authentication uses a
Bearer token. Both values are kept in `ElectronSecretStore`; neither is emitted
to the dashboard/mobile state or logs. `WIZEBOT_API_URL` and `WIZEBOT_TOKEN` are
also supported for managed distributions.
