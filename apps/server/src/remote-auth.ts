import { DEVICE_PERMISSIONS, validateDevicePermissions, type DevicePermission } from '../../mobile/shared/device-permissions.js';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { RemoteDevice } from '../../../packages/contracts/src/index.js';

interface Pairing { digest: Buffer; expiresAt: number; used: boolean; management?: boolean; permissions?: DevicePermission[] }
interface WsTicket { deviceId: string; expiresAt: number; used: boolean }
interface DeviceRecord extends RemoteDevice { credentialHash: Buffer; management?: boolean; permissions?: DevicePermission[] }
export interface PersistedPairing { id: string; digest: string; expiresAt: number; management?: boolean; permissions?: DevicePermission[] }
export interface PersistedRemoteDevice extends RemoteDevice { credentialHash: string; management?: boolean; permissions?: DevicePermission[] }

export class RemoteAuth {
  private pairing = new Map<string, Pairing>();
  private devices = new Map<string, DeviceRecord>();
  private attempts = new Map<string, number[]>();
  private wsTickets = new Map<string, WsTicket>();

  constructor(private now: () => number = Date.now, initial: PersistedRemoteDevice[] = [], pending: PersistedPairing[] = []) {
    for (const value of pending) {
      if (!value || typeof value.digest !== 'string') continue;
      const digest = Buffer.from(value.digest, 'base64');
      if (digest.length === 32 && value.expiresAt > this.now()) this.pairing.set(value.id, { digest, expiresAt: value.expiresAt, used: false, management: value.management === true, ...(Object.hasOwn(value,'permissions')?{permissions:validateDevicePermissions(value.permissions)}:{}) });
    }
    for (const device of initial) {
      const credentialHash = Buffer.from(device.credentialHash, 'base64');
      if (credentialHash.length === 32) this.devices.set(device.id, { ...device, credentialHash, ...(Object.hasOwn(device,'permissions')?{permissions:validateDevicePermissions(device.permissions)}:{}) });
    }
  }

  createPairing(ttlMs = 5 * 60_000, management = false, permissions?: DevicePermission[]) {
    this.cleanup();
    const code = randomBytes(6).toString('base64url').toUpperCase();
    const id = randomUUID();
    const expiresAt = this.now() + ttlMs;
    this.pairing.set(id, { digest: this.hash(code), expiresAt, used: false, management, ...(permissions?{permissions:validateDevicePermissions(permissions)}:{}) });
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
      management: value.management === true,
      ...(value.permissions?{permissions:[...value.permissions]}:{}),
    });
    return { deviceId, credential, management: value.management === true, permissions:this.permissions(deviceId) };
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

  canManage(id: string) { const device = this.devices.get(id); return Boolean(device && !device.revokedAt && device.management); }

  permissions(id: string): DevicePermission[] {
    const device=this.devices.get(id);
    return !device||device.revokedAt?[]:device.permissions?[...device.permissions]:Object.keys(DEVICE_PERMISSIONS) as DevicePermission[];
  }
  permits(id:string, permissions:DevicePermission[]) { const allowed=this.permissions(id);return permissions.every(permission=>allowed.includes(permission)); }
  setPermissions(id:string, value:unknown) {
    const permissions=validateDevicePermissions(value),device=this.devices.get(id);
    if(!device||device.revokedAt)throw new Error('Appareil absent ou révoqué.');
    device.permissions=permissions;
    for(const [ticket,entry] of this.wsTickets)if(entry.deviceId===id)this.wsTickets.delete(ticket);
  }

  createWsTicket(credential: string, ttlMs = 15_000) {
    this.cleanup();
    const deviceId = this.authenticate(credential);
    if (!deviceId || !this.permits(deviceId,['observe'])) throw new Error('Télécommande non autorisée.');
    const ticket = randomBytes(32).toString('base64url');
    this.wsTickets.set(ticket, { deviceId, expiresAt: this.now() + ttlMs, used: false });
    return { ticket, expiresAt: new Date(this.now() + ttlMs).toISOString() };
  }

  consumeWsTicket(ticket: string) {
    this.cleanup();
    const value = this.wsTickets.get(ticket);
    if (!value || value.used || value.expiresAt <= this.now()) return null;
    const device = this.devices.get(value.deviceId);
    if (!device || device.revokedAt || !this.permits(value.deviceId,['observe'])) return null;
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

  serializePairings(): PersistedPairing[] {
    this.cleanup();
    return [...this.pairing].map(([id, value]) => ({ id, digest: value.digest.toString('base64'), expiresAt: value.expiresAt, management: value.management === true, ...(value.permissions?{permissions:[...value.permissions]}:{}) }));
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
