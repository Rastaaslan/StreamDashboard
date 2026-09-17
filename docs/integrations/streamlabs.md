# Streamlabs support provider

The provider-neutral support history and Streamlabs boundary are implemented.
Supports use integer minor units, `(provider, externalId)` uniqueness, durable
history and per-currency session/day/month/all aggregates. An inserted support
publishes one correlated `support.received` domain event, which can trigger an
automation without the automation importing Streamlabs.

The Streamlabs socket token is accepted only by the local-PC configuration route
and is stored through `SecretStore`/Electron encrypted storage. It is never
returned to Android, state, logs or URLs. Without a token the provider reports
`NOT_CONFIGURED`. This distribution does not bundle a verified Streamlabs socket
transport, so providing a token reports `ERROR/STREAMLABS_TRANSPORT_UNAVAILABLE`
rather than a fake connection. The injected `StreamlabsTransport` boundary is
ready for a separately validated official transport.
