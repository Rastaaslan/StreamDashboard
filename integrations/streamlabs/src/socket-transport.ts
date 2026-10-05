import WebSocket from 'ws';
import type { StreamlabsTransport } from './adapter.js';

const SOCKET_ENDPOINT = 'wss://sockets.streamlabs.com/socket.io/';

type Socket = Pick<WebSocket, 'on' | 'send' | 'close' | 'readyState'> & Partial<Pick<WebSocket, 'terminate'>>;

export interface StreamlabsSocketOptions {
  endpoint?: string;
  signal?: AbortSignal;
  createSocket?: (url: string) => Socket;
  connectTimeoutMs?: number;
  logger?: Pick<Console, 'info' | 'warn'>;
}

/** Official Streamlabs Socket API transport (Socket.IO over Engine.IO websocket). */
export class StreamlabsSocketTransport implements StreamlabsTransport {
  constructor(private readonly options: StreamlabsSocketOptions = {}) {}

  connect(token: string, onTip: (value: unknown) => void, onDisconnect: (error?: Error) => void): Promise<() => Promise<void>> {
    this.options.signal?.throwIfAborted();
    const endpoint = new URL(this.options.endpoint ?? SOCKET_ENDPOINT);
    endpoint.searchParams.set('token', token);
    endpoint.searchParams.set('EIO', '3');
    endpoint.searchParams.set('transport', 'websocket');
    const socket = this.options.createSocket?.(endpoint.toString()) ?? new WebSocket(endpoint);
    let closed = false;
    let settled = false;
    let opened = false;
    let pingInterval = 25_000;
    let pingTimeout = 20_000;
    let pingTimer: NodeJS.Timeout | undefined;
    let pongTimer: NodeJS.Timeout | undefined;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => shutdown(new Error('Délai de connexion Streamlabs dépassé.')), this.options.connectTimeoutMs ?? 15_000);
      const shutdown = (error?: Error, closeSocket = true) => {
        if (closed) return;
        closed = true;
        this.options.signal?.removeEventListener('abort', abort);
        clearTimeout(timeout);
        clearTimeout(pingTimer);
        clearTimeout(pongTimer);
        // Finalize locally even if the peer never acknowledges the WebSocket close.
        if (closeSocket) {
          if (error && socket.terminate) socket.terminate();
          else socket.close(1000, 'StreamDashboard shutdown');
        }
        if (!settled) { settled = true; reject(error ?? new Error('Connexion Streamlabs fermée avant authentification.')); }
        else if (error) onDisconnect(error);
      };
      const abort = () => shutdown(this.options.signal?.reason ?? new Error('Streamlabs startup cancelled'));
      this.options.signal?.addEventListener('abort', abort, { once: true });
      const send = (frame: string) => {
        try { socket.send(frame); }
        catch { shutdown(new Error('Connexion Streamlabs impossible.')); }
      };
      const schedulePing = () => {
        if (closed) return;
        clearTimeout(pingTimer);
        pingTimer = setTimeout(() => {
          pingTimer = undefined;
          // Engine.IO v3: client sends ping (2), server answers pong (3).
          pongTimer = setTimeout(() => shutdown(new Error('Heartbeat Streamlabs expiré : pong absent.')), pingTimeout);
          pongTimer.unref();
          send('2');
        }, pingInterval);
        pingTimer.unref();
      };
      socket.on('message', (raw: WebSocket.RawData) => {
        if (closed) return;
        const frame = raw.toString();
        if (frame.startsWith('0')) {
          if (opened) return;
          try {
            const handshake = JSON.parse(frame.slice(1));
            if (!handshake || !Number.isFinite(handshake.pingInterval) || handshake.pingInterval <= 0
              || !Number.isFinite(handshake.pingTimeout) || handshake.pingTimeout <= 0) throw new Error('Invalid heartbeat');
            // Bound both silence detection and timer frequency for malformed peers.
            pingInterval = Math.max(1_000, Math.min(60_000, handshake.pingInterval));
            pingTimeout = Math.max(1_000, Math.min(30_000, handshake.pingTimeout));
            opened = true;
            schedulePing();
          } catch { shutdown(new Error('Handshake Engine.IO Streamlabs invalide.')); }
          return;
        }
        if (frame === '3') {
          if (pongTimer) { clearTimeout(pongTimer); pongTimer = undefined; schedulePing(); }
          return;
        }
        if (frame === '2') { send('3'); return; }
        if (frame === '40') {
          if (!opened) { shutdown(new Error('Handshake Engine.IO Streamlabs manquant.')); return; }
          if (settled) return;
          settled = true;
          this.options.signal?.removeEventListener('abort', abort);
          clearTimeout(timeout);
          this.options.logger?.info('Streamlabs connected');
          resolve(async () => shutdown());
          return;
        }
        if (!settled || !frame.startsWith('42')) return;
        try {
          const packet = JSON.parse(frame.slice(2));
          if (!Array.isArray(packet) || packet[0] !== 'event') return;
          for (const tip of extractDonations(packet[1])) onTip(tip);
        } catch {
          this.options.logger?.warn('Streamlabs event rejected');
        }
      });
      socket.on('error', (error: Error) => {
        shutdown(new Error(/401|403|unauthor|token/i.test(error.message) ? 'Authentification Streamlabs refusée.' : 'Connexion Streamlabs impossible.'));
      });
      socket.on('close', (code: number) => {
        shutdown(new Error(code === 1008 ? 'Authentification Streamlabs refusée.' : 'Connexion Streamlabs interrompue.'), false);
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
