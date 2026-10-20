import SHA256 from 'crypto-js/sha256.js';
// Used for stable provider/event identities, never OAuth or cryptographic keys.
export function createHash(algorithm) {
  if (algorithm !== 'sha256') throw new Error('Unsupported identity hash');
  let value = '';
  return { update(part) { value += part; return this; }, digest(encoding) {
    if (encoding !== 'hex') throw new Error('Unsupported identity encoding');
    return SHA256(value).toString();
  } };
}

export function randomUUID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (!globalThis.crypto?.getRandomValues) throw new Error('Random event identity unavailable');
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
