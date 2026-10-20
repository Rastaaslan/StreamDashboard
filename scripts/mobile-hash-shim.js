import SHA256 from 'crypto-js/sha256.js';
// Used only for stable Google projection IDs, never OAuth or cryptographic keys.
export function createHash(algorithm) {
  if (algorithm !== 'sha256') throw new Error('Unsupported identity hash');
  let value = '';
  return { update(part) { value += part; return this; }, digest(encoding) {
    if (encoding !== 'hex') throw new Error('Unsupported identity encoding');
    return SHA256(value).toString();
  } };
}
