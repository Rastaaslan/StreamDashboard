import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { RemoteDevice } from '../../../packages/contracts/src/index.js';

interface Pairing { digest: Buffer; expiresAt: number; used: boolean }
interface DeviceRecord extends RemoteDevice { credentialHash: Buffer }
export class RemoteAuth {
  private pairing = new Map<string, Pairing>();
  private devices = new Map<string, DeviceRecord>();
  private attempts = new Map<string, number[]>();
  constructor(private now: () => number = Date.now) {}
  createPairing(ttlMs = 5 * 60_000) { const code = randomBytes(6).toString('base64url').toUpperCase(); const id = randomUUID(); this.pairing.set(id, { digest: this.hash(code), expiresAt: this.now() + ttlMs, used: false }); return { id, code, expiresAt: new Date(this.now() + ttlMs).toISOString() }; }
  pair(id: string, code: string, name: string, address = 'unknown') { this.limit(address); const value = this.pairing.get(id); if (!value || value.used || value.expiresAt <= this.now() || !this.equal(value.digest, this.hash(code))) throw new Error('Code de pairing invalide ou expiré.'); value.used = true; const credential = randomBytes(32).toString('base64url'), deviceId = randomUUID(), at = new Date(this.now()).toISOString(); this.devices.set(deviceId, { id: deviceId, name: name.trim().slice(0, 80) || 'Android', createdAt: at, lastSeenAt: at, credentialHash: this.hash(credential) }); return { deviceId, credential }; }
  authenticate(credential: string) { const digest = this.hash(credential); for (const device of this.devices.values()) if (!device.revokedAt && this.equal(device.credentialHash, digest)) { device.lastSeenAt = new Date(this.now()).toISOString(); return device.id; } return null; }
  revoke(id: string) { const device = this.devices.get(id); if (device) device.revokedAt = new Date(this.now()).toISOString(); }
  list(): RemoteDevice[] { return [...this.devices.values()].map(({ credentialHash: _secret, ...device }) => ({ ...device })); }
  private limit(key: string) { const cutoff = this.now() - 60_000, attempts = (this.attempts.get(key) ?? []).filter(x => x > cutoff); if (attempts.length >= 10) throw new Error('Trop de tentatives de pairing.'); attempts.push(this.now()); this.attempts.set(key, attempts); }
  private hash(value: string) { return createHash('sha256').update(value).digest(); }
  private equal(a: Buffer, b: Buffer) { return a.length === b.length && timingSafeEqual(a, b); }
}
