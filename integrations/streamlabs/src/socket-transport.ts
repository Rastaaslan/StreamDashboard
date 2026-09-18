import WebSocket from 'ws';
import type { StreamlabsTransport } from './adapter.js';

const SOCKET_ENDPOINT = 'wss://sockets.streamlabs.com/socket.io/';

type Socket = Pick<WebSocket, 'on' | 'send' | 'close' | 'readyState'>;

export interface StreamlabsSocketOptions {
  endpoint?: string;
  createSocket?: (url: string) => Socket;
  connectTimeoutMs?: number;
  logger?: Pick<Console, 'info' | 'warn'>;
}

/** Official Streamlabs Socket API transport (Socket.IO over Engine.IO websocket). */
export class StreamlabsSocketTransport implements StreamlabsTransport {
  constructor(private readonly options: StreamlabsSocketOptions = {}) {}

  connect(token: string, onTip: (value: unknown) => void, onDisconnect: (error?: Error) => void): Promise<() => Promise<void>> {
    const endpoint = new URL(this.options.endpoint ?? SOCKET_ENDPOINT);
    endpoint.searchParams.set('token', token);
    endpoint.searchParams.set('EIO', '3');
    endpoint.searchParams.set('transport', 'websocket');
    const socket = this.options.createSocket?.(endpoint.toString()) ?? new WebSocket(endpoint);
    let intentionallyClosed = false;
    let settled = false;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('Délai de connexion Streamlabs dépassé.')), this.options.connectTimeoutMs ?? 15_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(async () => {
          intentionallyClosed = true;
          if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(1000, 'StreamDashboard shutdown');
        });
      };
      socket.on('open', () => undefined);
      socket.on('message', (raw: WebSocket.RawData) => {
        const frame = raw.toString();
        if (frame === '2') { socket.send('3'); return; }
        if (frame === '40') {
          this.options.logger?.info('Streamlabs connected');
          finish();
          return;
        }
        if (!frame.startsWith('42')) return;
        try {
          const packet = JSON.parse(frame.slice(2));
          if (!Array.isArray(packet) || packet[0] !== 'event') return;
          for (const tip of extractDonations(packet[1])) onTip(tip);
        } catch {
          this.options.logger?.warn('Streamlabs event rejected');
        }
      });
      socket.on('error', (error: Error) => {
        const safe = new Error(/401|403|unauthor|token/i.test(error.message) ? 'Authentification Streamlabs refusée.' : 'Connexion Streamlabs impossible.');
        if (!settled) finish(safe);
      });
      socket.on('close', (code: number) => {
        clearTimeout(timeout);
        if (!settled) { finish(new Error(code === 1008 ? 'Authentification Streamlabs refusée.' : 'Connexion Streamlabs fermée avant authentification.')); return; }
        if (!intentionallyClosed) onDisconnect(new Error('Connexion Streamlabs interrompue.'));
        this.options.logger?.info('Streamlabs disconnected');
      });
    });
  }
}

export function extractDonations(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return [];
  const event = value as Record<string, unknown>;
  if (event.type !== 'donation') return [];
  const messages = Array.isArray(event.message) ? event.message : [event.message];
  return messages.filter(item => item && typeof item === 'object').map(item => {
    const row = item as Record<string, unknown>;
    const amount = Number(row.amount);
    return {
      id: row._id ?? row.id,
      name: row.name,
      message: row.message,
      currency: row.currency,
      amountMinor: Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN,
      receivedAt: row.created_at ?? row.createdAt,
    };
  });
}
