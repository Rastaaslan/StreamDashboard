import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { StreamlabsSocketTransport, extractDonations } from '../integrations/streamlabs/src/socket-transport.js';
import { StreamlabsAdapter } from '../integrations/streamlabs/src/adapter.js';
import { SupportRuntime } from '../apps/server/src/support-runtime.js';

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: string[] = [];
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; this.emit('close', 1000); }
}

describe('transport Streamlabs officiel', () => {
  it('ne place jamais le token dans les logs et négocie Socket.IO', async () => {
    const socket = new FakeSocket(); const logger = { info: vi.fn(), warn: vi.fn() };
    let url = '';
    const connected = new StreamlabsSocketTransport({ createSocket: value => { url = value; return socket as never; }, logger, connectTimeoutMs: 100 });
    const operation = connected.connect('ultra-secret', vi.fn(), vi.fn());
    socket.emit('message', Buffer.from('40'));
    const close = await operation;
    expect(new URL(url).searchParams.get('token')).toBe('ultra-secret');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('ultra-secret');
    socket.emit('message', Buffer.from('2')); expect(socket.sent).toEqual(['3']);
    await close();
  });

  it('convertit uniquement les donations valides du paquet officiel', () => {
    expect(extractDonations({ type: 'follow', message: [{}] })).toEqual([]);
    expect(extractDonations({ type: 'donation', message: [{ _id: 'd1', name: 'Ada', amount: '5.25', currency: 'EUR', message: 'GG' }] })).toEqual([expect.objectContaining({ id: 'd1', amountMinor: 525, currency: 'EUR' })]);
  });

  it('alimente le runtime de façon idempotente et dégrade les événements invalides', async () => {
    const stored: never[] = []; const runtime = new SupportRuntime([], async () => undefined, value => stored.push(value as never));
    let receive: (value: unknown) => void = () => undefined;
    const adapter = new StreamlabsAdapter('token', value => runtime.record(value).then(() => undefined), { connect: async (_token, onTip) => { receive = onTip; return async () => undefined; } });
    await adapter.connect();
    const tip = { id: 'same', amountMinor: 500, currency: 'EUR', name: 'Ada' };
    receive(tip); receive(tip); await new Promise(resolve => setTimeout(resolve, 0));
    expect(runtime.list()).toHaveLength(1); expect(stored).toHaveLength(1);
    receive({ nope: true }); await new Promise(resolve => setTimeout(resolve, 0));
    expect(adapter.state().status).toBe('DEGRADED');
    await adapter.disconnect(); expect(adapter.state().status).toBe('DISCONNECTED');
  });
});
