import type { Server } from 'node:http';
import type { Socket } from 'node:net';

/** Drain accepted requests, including writes, but never wait for a browser's
 * speculative TCP connection which has not submitted an HTTP request. */
export function prepareHttpShutdown(server: Server): () => Promise<void> {
  const pending = new Map<Socket, number>();
  let closing = false;
  let stopping: Promise<void> | undefined;
  server.on('connection', socket => {
    if (closing) { socket.destroy(); return; }
    pending.set(socket, 0);
    socket.once('close', () => pending.delete(socket));
  });
  server.prependListener('request', (request, response) => {
    const socket = request.socket;
    pending.set(socket, (pending.get(socket) ?? 0) + 1);
    let finished = false;
    const release = () => {
      if (finished) return;
      finished = true;
      const count = Math.max(0, (pending.get(socket) ?? 1) - 1);
      if (pending.has(socket)) pending.set(socket, count);
      // end() flushes the response before sending FIN; it does not discard a
      // completed mutation's acknowledgement as destroy() would.
      if (closing && count === 0) socket.end();
    };
    response.once('finish', release);
    response.once('close', release);
  });
  return () => stopping ??= new Promise<void>((resolve, reject) => {
    closing = true;
    server.close(error => error ? reject(error) : resolve());
    for (const [socket, count] of pending) if (count === 0) socket.destroy();
  });
}
