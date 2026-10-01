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

it('timer readiness requires an enabled attached browser, matching URL and reachable HTTP endpoint', async () => {
  const { createServer } = await import('node:http');
  let httpStatus = 200, attached = true, enabled = true, present = true, muted = false, volume = 1, routed = true;
  const http = createServer((_req, res) => { res.writeHead(httpStatus, { 'content-type': 'text/html' }); res.end('timer'); });
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  const address = http.address(); if (!address || typeof address === 'string') throw new Error('No HTTP port');
  const endpoint = `http://127.0.0.1:${address.port}/overlay/timer/`;
  let url = endpoint, kind = 'browser_source';
  let discoveryFails = false;
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  server.on('connection', socket => {
    socket.send(encode({ op: 0, d: { obsWebSocketVersion: '5.6.3', rpcVersion: 1 } }));
    socket.on('message', data => {
      const message = decode(new Uint8Array(data as Buffer)) as { op: number; d: Record<string, string> };
      if (message.op === 1) { socket.send(encode({ op: 2, d: { negotiatedRpcVersion: 1 } })); return; }
      if (message.op !== 6) return;
      const { requestId, requestType } = message.d;
      const responses: Record<string, unknown> = {
        GetVersion: { obsVersion: '31', obsWebSocketVersion: '5' },
        GetCurrentProgramScene: { currentProgramSceneName: 'Live' }, GetSceneList: { scenes: [{ sceneName: 'Live' }] },
        GetStreamStatus: { outputActive: false }, GetRecordStatus: { outputActive: false },
        GetInputList: { inputs: present ? [{ inputName: 'Timer', inputKind: kind }, { inputName: 'Soundboard', inputKind: 'ffmpeg_source' }] : [] },
        GetSceneItemList: { sceneItems: attached ? [{ sourceName: 'Timer', sceneItemEnabled: enabled }, { sourceName: 'Soundboard', sceneItemEnabled: enabled }] : [] },
        GetInputSettings: { inputSettings: { url } },
        GetInputMute: { inputMuted: muted }, GetInputVolume: { inputVolumeMul: volume, inputVolumeDb: 0 },
        GetInputAudioTracks: { inputAudioTracks: { '1': routed } }, GetInputAudioMonitorType: { monitorType: 'OBS_MONITORING_TYPE_NONE' },
      };
      socket.send(encode({ op: 7, d: { requestId, requestType, requestStatus: discoveryFails && requestType === 'GetSceneItemList' ? { result: false, code: 600, comment: 'Discovery denied' } : { result: true, code: 100 }, responseData: responses[requestType] || {} } }));
    });
  });
  await once(server, 'listening');
  const wsAddress = server.address(); if (!wsAddress || typeof wsAddress === 'string') throw new Error('No WS port');
  const obs = new ObsClient(`ws://127.0.0.1:${wsAddress.port}`);
  try {
    await obs.connect();
    await expect(obs.verifyTimerBrowserSource('Timer', endpoint)).resolves.toBeUndefined();
    await expect(obs.verifySoundboardPlayback('Soundboard')).resolves.toBeUndefined();
    muted = true; await expect(obs.verifySoundboardPlayback('Soundboard')).rejects.toThrow('inaudible');
    muted = false; volume = 0; await expect(obs.verifySoundboardPlayback('Soundboard')).rejects.toThrow('inaudible');
    volume = 1; routed = false; await expect(obs.verifySoundboardPlayback('Soundboard')).rejects.toThrow('inaudible');
    routed = true; enabled = false; await expect(obs.verifySoundboardPlayback('Soundboard')).rejects.toThrow('inactive');
    enabled = true;
    discoveryFails = true; await expect(obs.sceneSourceEnabled('Live', 'Timer')).rejects.toThrow('Requête OBS impossible');
    discoveryFails = false; kind = 'ffmpeg_source'; await expect(obs.verifyTimerBrowserSource('Timer', endpoint)).rejects.toThrow();
    kind = 'browser_source';
    enabled = false; await expect(obs.verifyTimerBrowserSource('Timer', endpoint)).rejects.toThrow('activé');
    enabled = true; attached = false; await expect(obs.verifyTimerBrowserSource('Timer', endpoint)).rejects.toThrow('attaché');
    attached = true; present = false; await expect(obs.verifyTimerBrowserSource('Timer', endpoint)).rejects.toThrow('absente');
    present = true; url = 'http://127.0.0.1:47832/overlay/timer/'; await expect(obs.verifyTimerBrowserSource('Timer', endpoint)).rejects.toThrow('URL timer attendue');
    url = endpoint; httpStatus = 503; await expect(obs.verifyTimerBrowserSource('Timer', endpoint)).rejects.toThrow('HTTP 503');
    await new Promise<void>(resolve => http.close(() => resolve()));
    await expect(obs.verifyTimerBrowserSource('Timer', endpoint)).rejects.toThrow();
  } finally {
    await obs.close(); for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (http.listening) await new Promise<void>(resolve => http.close(() => resolve()));
  }
});
