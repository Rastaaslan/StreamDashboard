import { encode, decode } from '@msgpack/msgpack';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { expect, it, vi } from 'vitest';
import { ObsClient } from '../integrations/obs/src/client.js';

const hash = (text: string) => createHash('sha256').update(text).digest('base64');

/** Exercise the actual obs-websocket-js transport and v5 authentication handshake. */
it('authenticates, loses OBS during a live, and recovers over a new websocket', async () => {
  let streaming = false;
  let authentications = 0;
  const requests: string[] = [];
  async function serve(port = 0) {
    const server = new WebSocketServer({ host: '127.0.0.1', port });
    server.on('connection', socket => {
      socket.send(encode({ op: 0, d: { obsWebSocketVersion: '5.6.3', rpcVersion: 1, authentication: { salt: 'salt', challenge: 'challenge' } } }));
      socket.on('message', data => {
        const message = decode(new Uint8Array(data as Buffer)) as { op: number; d: Record<string, string> };
        if (message.op === 1) {
          if (message.d.authentication !== hash(hash('test-password' + 'salt') + 'challenge')) {
            socket.close(4009, 'Authentication failed'); return;
          }
          authentications++;
          socket.send(encode({ op: 2, d: { negotiatedRpcVersion: 1 } }));
          return;
        }
        if (message.op !== 6) return;
        const { requestId, requestType } = message.d;
        requests.push(requestType);
        let responseData: unknown = {};
        switch (requestType) {
          case 'GetVersion': responseData = { obsVersion: '31.0', obsWebSocketVersion: '5.6.3' }; break;
          case 'GetStreamStatus': responseData = { outputActive: streaming }; break;
          case 'GetRecordStatus': responseData = { outputActive: false }; break;
          case 'GetCurrentProgramScene': responseData = { currentProgramSceneName: 'Live' }; break;
          case 'GetSceneList': responseData = { scenes: [{ sceneName: 'Live' }] }; break;
          case 'GetInputList': responseData = { inputs: [] }; break;
          case 'GetSceneItemList': responseData = { sceneItems: [] }; break;
          case 'StartStream':
            streaming = true;
            socket.send(encode({ op: 5, d: { eventType: 'StreamStateChanged', eventIntent: 64, eventData: { outputActive: true } } }));
            break;
        }
        socket.send(encode({ op: 7, d: { requestId, requestType, requestStatus: { result: true, code: 100 }, responseData } }));
      });
    });
    await once(server, 'listening');
    return server;
  }
  let server = await serve();
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  const obs = new ObsClient('ws://127.0.0.1:' + address.port, 'test-password');
  try {
    await obs.connect();
    expect(obs.state).toMatchObject({ connected: true, streamingKnown: true });
    await obs.stream(true);
    await obs.waitForStreaming(true);
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await vi.waitFor(() => expect(obs.state.connected).toBe(false));
    expect(obs.state).toMatchObject({ streaming: true, streamingKnown: false, scene: null, inputs: {} });
    await expect(obs.mute('Mic', true)).rejects.toThrow();
    streaming = false;
    server = await serve(address.port);
    await vi.waitFor(() => expect(obs.state.connected).toBe(true), { timeout: 5000 });
    expect(obs.state).toMatchObject({ streaming: false, streamingKnown: true, scene: 'Live' });
    expect(authentications).toBe(2);
    expect(requests.filter(type => type === 'StartStream')).toHaveLength(1);
  } finally {
    await obs.close();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 15000);
