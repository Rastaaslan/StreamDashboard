# Events and actions

`EventEnvelope` is the provider-neutral realtime primitive. It carries a UUID,
schema version, type, source, occurrence/receipt timestamps, correlation ID and a
typed payload. `EventCore` validates names, assigns identifiers, notifies local
subscribers and retains at most 250 diagnostics entries in the runtime. This
bounded buffer is diagnostic data, not durable business history.

`ActionCommand` describes origin, device, issuance and correlation. `ActionCore`
deduplicates concurrent and completed command IDs, so network retries cannot
repeat a non-idempotent handler. Acknowledgements report `succeeded` or `failed`
with a stable error code. The existing dashboard command service remains the V1
adapter while action envelopes gain endpoint-specific integration coverage.

Correlation IDs are preserved by action handlers and events, enabling a future
chain such as support → automation → soundboard → runtime ACK without coupling
the automation engine to Streamlabs or an audio implementation.
