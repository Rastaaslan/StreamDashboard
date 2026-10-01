import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwitchEventSub } from '../integrations/twitch/src/eventsub.js';
import { StreamlabsSocketTransport } from '../integrations/streamlabs/src/socket-transport.js';
import { StreamlabsAdapter } from '../integrations/streamlabs/src/adapter.js';

class Socket extends EventEmitter {
  readyState = 1;
  close = vi.fn(() => { this.readyState = 3; this.emit('close', 1000); });
  send = vi.fn();
  message(value: unknown) { this.emit('message', Buffer.from(JSON.stringify(value))); }
}
const welcome = { metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'session', keepalive_timeout_seconds: 10 } } };
afterEach(() => vi.useRealTimers());

describe('Desktop provider recovery', () => {
  it('keeps the new Twitch watchdog when the previous socket closes', async () => {
    vi.useFakeTimers();
    const sockets: Socket[] = [];
    const client = new TwitchEventSub(async () => {}, vi.fn(), vi.fn(), () => { const socket = new Socket(); sockets.push(socket); return socket as never; });
    client.start();
    sockets[0].message(welcome);
    await Promise.resolve();
    sockets[0].message({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/reconnect' } } });
    sockets[1].message(welcome);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sockets[1].close).toHaveBeenCalledOnce();
    client.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores late subscriptions and malformed or foreign reconnect frames', async () => {
    vi.useFakeTimers();
    const socket = new Socket(); const status = vi.fn();
    let resolve!: () => void;
    const subscribe = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const factory = vi.fn(() => socket as never);
    const client = new TwitchEventSub(subscribe, vi.fn(), status, factory);
    client.start();
    socket.message(null);
    socket.message(welcome); socket.message(welcome);
    expect(subscribe).toHaveBeenCalledOnce();
    for (const reconnect_url of ['http://localhost/private', '://invalid']) socket.message({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url } } });
    expect(factory).toHaveBeenCalledOnce();
    client.stop(); resolve(); await Promise.resolve();
    expect(status).toHaveBeenLastCalledWith('DISCONNECTED');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reconnects a Twitch socket that never sends a welcome with bounded pacing', async () => {
    vi.useFakeTimers(); const sockets: Socket[] = [];
    const client = new TwitchEventSub(async () => {}, vi.fn(), vi.fn(), () => { const socket = new Socket(); sockets.push(socket); return socket as never; });
    client.start();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(sockets.length).toBeGreaterThan(2); expect(sockets.length).toBeLessThan(9);
    client.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it('closes a timed-out Streamlabs handshake and ignores late events', async () => {
    vi.useFakeTimers(); const socket = new Socket(); const tip = vi.fn(); const disconnected = vi.fn();
    const transport = new StreamlabsSocketTransport({ createSocket: () => socket as never, connectTimeoutMs: 100 });
    const result = expect(transport.connect('secret', tip, disconnected)).rejects.toThrow('Délai');
    await vi.advanceTimersByTimeAsync(100); await result;
    socket.emit('message', Buffer.from('42["event",{"type":"donation","message":{"id":"late"}}]'));
    expect(socket.close).toHaveBeenCalledOnce(); expect(tip).not.toHaveBeenCalled(); expect(disconnected).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends Engine.IO v3 pings and schedules the next ping only after pong', async () => {
    vi.useFakeTimers(); const socket = new Socket(); const disconnected = vi.fn();
    const transport = new StreamlabsSocketTransport({ createSocket: () => socket as never });
    const connecting = transport.connect('token', vi.fn(), disconnected);
    socket.emit('message', Buffer.from('0{"pingInterval":2000,"pingTimeout":1000}'));
    socket.emit('message', Buffer.from('40'));
    const close = await connecting;
    await vi.advanceTimersByTimeAsync(1999); expect(socket.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(socket.send).toHaveBeenLastCalledWith('2');
    await vi.advanceTimersByTimeAsync(500); socket.emit('message', Buffer.from('3'));
    await vi.advanceTimersByTimeAsync(1999); expect(socket.send).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(socket.send).toHaveBeenCalledTimes(2);
    socket.emit('message', Buffer.from('3'));
    expect(disconnected).not.toHaveBeenCalled();
    await close(); expect(vi.getTimerCount()).toBe(0);
  });

  it('detects missing pong without waiting for the WebSocket close event', async () => {
    vi.useFakeTimers(); const socket = new Socket(); const disconnected = vi.fn(); const tip = vi.fn();
    socket.close.mockImplementation(() => { socket.readyState = 2; });
    const transport = new StreamlabsSocketTransport({ createSocket: () => socket as never });
    const connecting = transport.connect('token', tip, disconnected);
    socket.emit('message', Buffer.from('0{"pingInterval":2000,"pingTimeout":1000}'));
    socket.emit('message', Buffer.from('40')); await connecting;
    await vi.advanceTimersByTimeAsync(2999); expect(disconnected).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(disconnected).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: expect.stringContaining('pong absent') }));
    expect(socket.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    socket.emit('message', Buffer.from('3'));
    socket.emit('message', Buffer.from('42["event",{"type":"donation","message":{"id":"late"}}]'));
    socket.emit('close', 1000);
    expect(disconnected).toHaveBeenCalledOnce(); expect(tip).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 2000])('cleans heartbeat timers on authenticated shutdown at %i ms', async elapsed => {
    vi.useFakeTimers(); const socket = new Socket(); const disconnected = vi.fn();
    const connecting = new StreamlabsSocketTransport({ createSocket: () => socket as never }).connect('token', vi.fn(), disconnected);
    socket.emit('message', Buffer.from('0{"pingInterval":2000,"pingTimeout":1000}'));
    socket.emit('message', Buffer.from('40')); const close = await connecting;
    await vi.advanceTimersByTimeAsync(elapsed); await close(); await close();
    expect(socket.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000); expect(disconnected).not.toHaveBeenCalled();
  });

  it('reconnects after heartbeat expiry and stops the recovered connection cleanly', async () => {
    vi.useFakeTimers(); const sockets: Socket[] = [];
    const transport = new StreamlabsSocketTransport({ createSocket: () => { const socket = new Socket(); sockets.push(socket); return socket as never; } });
    const adapter = new StreamlabsAdapter('token', async () => {}, transport);
    const authenticate = (socket: Socket) => {
      socket.emit('message', Buffer.from('0{"pingInterval":2000,"pingTimeout":1000}'));
      socket.emit('message', Buffer.from('40'));
    };
    const connecting = adapter.connect(); authenticate(sockets[0]); await connecting;
    await vi.advanceTimersByTimeAsync(3000); expect(adapter.state().status).toBe('DEGRADED');
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000); expect(sockets).toHaveLength(2);
    authenticate(sockets[1]); await Promise.resolve();
    expect(adapter.state().status).toBe('CONNECTED');
    await vi.advanceTimersByTimeAsync(2000); sockets[1].emit('message', Buffer.from('3'));
    await adapter.disconnect(); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000); expect(sockets).toHaveLength(2);
    expect(adapter.state().status).toBe('DISCONNECTED');
  });

  it.each(['close', 'error'])('cleans heartbeat timers on socket %s', async event => {
    vi.useFakeTimers(); const socket = new Socket(); const disconnected = vi.fn();
    const connecting = new StreamlabsSocketTransport({ createSocket: () => socket as never }).connect('token', vi.fn(), disconnected);
    socket.emit('message', Buffer.from('0{"pingInterval":2000,"pingTimeout":1000}'));
    socket.emit('message', Buffer.from('40')); await connecting;
    await vi.advanceTimersByTimeAsync(2000);
    socket.emit(event, event === 'error' ? new Error('network down') : 1006);
    expect(disconnected).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('closes a Streamlabs connection completing after shutdown', async () => {
    let finish!: (close: () => Promise<void>) => void;
    const close = vi.fn(async () => {});
    const transport = { connect: vi.fn(() => new Promise<() => Promise<void>>(resolve => { finish = resolve; })) };
    const adapter = new StreamlabsAdapter('token', async () => {}, transport);
    const first = adapter.connect(); const second = adapter.connect();
    expect(transport.connect).toHaveBeenCalledOnce();
    await adapter.disconnect(); finish(close); await Promise.all([first, second]);
    expect(close).toHaveBeenCalledOnce(); expect(adapter.state().status).toBe('DISCONNECTED');
  });

  it('retries failed Streamlabs handshakes with a single capped backoff', async () => {
    vi.useFakeTimers(); const connect = vi.fn(async () => { throw new Error('offline'); });
    const adapter = new StreamlabsAdapter('token', async () => {}, { connect });
    await adapter.connect(); await vi.advanceTimersByTimeAsync(300_000);
    expect(connect.mock.calls.length).toBeGreaterThan(5); expect(connect.mock.calls.length).toBeLessThan(16);
    await adapter.disconnect(); expect(vi.getTimerCount()).toBe(0);
  });
});
