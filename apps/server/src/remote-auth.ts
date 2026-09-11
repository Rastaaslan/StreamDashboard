import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { RemoteDevice } from '../../../packages/contracts/src/index.js';

interface Pairing { digest: Buffer; expiresAt: number; used: boolean }
interface WsTicket { deviceId: string; expiresAt: number; used: boolean }
interface DeviceRecord extends RemoteDevice { credentialHash: Buffer }
export interface PersistedRemoteDevice extends RemoteDevice { credentialHash: string }

export class RemoteAuth {
  private pairing = new Map<string, Pairing>();
  private devices = new Map<string, DeviceRecord>();
  private attempts = new Map<string, number[]>();
  private wsTickets = new Map<string, WsTicket>();

  constructor(private now: () => number = Date.now, initial: PersistedRemoteDevice[] = []) {
    for (const device of initial) {
      const credentialHash = Buffer.from(device.credentialHash, 'base64');
      if (credentialHash.length === 32) this.devices.set(device.id, { ...device, credentialHash });
    }
  }

  createPairing(ttlMs = 5 * 60_000) {
    this.cleanup();
    const code = randomBytes(6).toString('base64url').toUpperCase();
    const id = randomUUID();
    const expiresAt = this.now() + ttlMs;
    this.pairing.set(id, { digest: this.hash(code), expiresAt, used: false });
    return { id, code, expiresAt: new Date(expiresAt).toISOString() };
  }

  pair(id: string, code: string, name: string, address = 'unknown') {
    this.cleanup();
    this.limit(address);
    const value = this.pairing.get(id);
    const normalizedCode = code.trim().toUpperCase();
    if (!value || value.used || value.expiresAt <= this.now() || !this.equal(value.digest, this.hash(normalizedCode))) {
      throw new Error('Code de pairing invalide ou expiré.');
    }
    value.used = true;
    const credential = randomBytes(32).toString('base64url');
    const deviceId = randomUUID();
    const at = new Date(this.now()).toISOString();
    this.devices.set(deviceId, {
      id: deviceId,
      name: name.trim().slice(0, 80) || 'Android',
      createdAt: at,
      lastSeenAt: at,
      credentialHash: this.hash(credential),
    });
    return { deviceId, credential };
  }

  authenticate(credential: string) {
    if (!credential) return null;
    const digest = this.hash(credential);
    for (const device of this.devices.values()) {
      if (!device.revokedAt && this.equal(device.credentialHash, digest)) {
        device.lastSeenAt = new Date(this.now()).toISOString();
        return device.id;
      }
    }
    return null;
  }

  createWsTicket(credential: string, ttlMs = 15_000) {
    this.cleanup();
    const deviceId = this.authenticate(credential);
    if (!deviceId) throw new Error('Télécommande non autorisée.');
    const ticket = randomBytes(32).toString('base64url');
    this.wsTickets.set(ticket, { deviceId, expiresAt: this.now() + ttlMs, used: false });
    return { ticket, expiresAt: new Date(this.now() + ttlMs).toISOString() };
  }

  consumeWsTicket(ticket: string) {
    this.cleanup();
    const value = this.wsTickets.get(ticket);
    if (!value || value.used || value.expiresAt <= this.now()) return null;
    const device = this.devices.get(value.deviceId);
    if (!device || device.revokedAt) return null;
    value.used = true;
    device.lastSeenAt = new Date(this.now()).toISOString();
    return device.id;
  }

  revoke(id: string) {
    const device = this.devices.get(id);
    if (!device) return false;
    device.revokedAt = new Date(this.now()).toISOString();
    for (const [ticket, value] of this.wsTickets) if (value.deviceId === id) this.wsTickets.delete(ticket);
    return true;
  }

  list(): RemoteDevice[] {
    return [...this.devices.values()].map(({ credentialHash: _secret, ...device }) => ({ ...device }));
  }

  serialize(): PersistedRemoteDevice[] {
    return [...this.devices.values()].map(device => ({ ...device, credentialHash: device.credentialHash.toString('base64') }));
  }

  private limit(key: string) {
    const cutoff = this.now() - 60_000;
    const attempts = (this.attempts.get(key) ?? []).filter(value => value > cutoff);
    if (attempts.length >= 10) throw new Error('Trop de tentatives de pairing.');
    attempts.push(this.now());
    this.attempts.set(key, attempts);
  }

  private cleanup() {
    const now = this.now();
    const cutoff = now - 60_000;
    for (const [id, value] of this.pairing) if (value.used || value.expiresAt <= now) this.pairing.delete(id);
    for (const [ticket, value] of this.wsTickets) if (value.used || value.expiresAt <= now) this.wsTickets.delete(ticket);
    for (const [key, values] of this.attempts) {
      const recent = values.filter(value => value > cutoff);
      if (recent.length) this.attempts.set(key, recent);
      else this.attempts.delete(key);
    }
  }

  private hash(value: string) { return createHash('sha256').update(value).digest(); }
  private equal(a: Buffer, b: Buffer) { return a.length === b.length && timingSafeEqual(a, b); }
}
