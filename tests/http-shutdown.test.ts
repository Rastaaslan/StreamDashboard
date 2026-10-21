import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { prepareHttpShutdown } from '../apps/server/src/http-shutdown.js';

it('closes speculative TCP sockets while draining and acknowledging an accepted write', async () => {
  let finish!: () => void;
  let accepted!: () => void;
  let persisted = false;
  const arrived = new Promise<void>(resolve => { accepted = resolve; });
  const server = createServer((_request, response) => {
    finish = () => { persisted = true; response.end('persisted'); };
    accepted();
  });
  const stop = prepareHttpShutdown(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as {port:number}).port;
  const speculative = connect(port, '127.0.0.1');
  await once(speculative, 'connect');
  const response = new Promise<string>((resolve, reject) => {
    const req = request({hostname:'127.0.0.1', port, method:'POST'}, res => {
      let body=''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(body)); res.on('error', reject);
    });
    req.on('error', reject); req.end('write');
  });
  try {
    await arrived;
    let stopped=false;
    const completion=stop(); completion.then(() => {stopped=true;});
    expect(stop()).toBe(completion);
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(stopped).toBe(false);
    finish();
    await expect(response).resolves.toBe('persisted');
    await completion;
    expect(persisted).toBe(true);
    expect(server.listening).toBe(false);
  } finally {
    speculative.destroy(); server.closeAllConnections(); await stop();
  }
});
