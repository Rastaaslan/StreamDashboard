// Android calls are serialized by the native bridge and the workspace lock.
// No AsyncLocalStorage cache is shared between accounts or operations.
export const syncBatch = work => work();
export const measureSync = (_provider, _phase, work) => work();
export async function boundedMap(values, work) { for (const value of values) await work(value); }
