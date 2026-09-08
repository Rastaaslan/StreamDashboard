import express from 'express';
import path from 'node:path';
import type { SequenceEngine } from '../sequences/engine.js';
export function createApp(engine: SequenceEngine, token = '') {
  const app = express(); app.use(express.json({ limit: '8kb' }));
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => { if (error instanceof SyntaxError) res.status(400).json({ error: 'Invalid JSON' }); else next(error); });
  const auth: express.RequestHandler = (req, res, next) => { if (token && req.get('authorization') !== `Bearer ${token}`) res.status(401).json({ error: 'Unauthorized' }); else next(); };
  app.get('/api/state', (_q, r) => r.json(engine.state()));
  app.get('/api/events', (req, res) => { res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); const send = (state: unknown) => res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`); send(engine.state()); engine.on('state', send); const keep = setInterval(() => { send(engine.state()); }, 1000); req.on('close', () => { clearInterval(keep); engine.off('state', send); }); });
  const route = (url: string, fn: () => unknown) => app.post(url, auth, async (_q, r, next) => { try { r.json(await fn()); } catch (e) { next(e); } });
  route('/api/intro/start', () => engine.start('intro')); route('/api/pause/start', () => engine.start('pause')); route('/api/pause/return', () => engine.returnFromPause()); route('/api/end/start', () => engine.start('end')); route('/api/end/cancel', () => engine.cancelEnd()); route('/api/sequence/cancel', () => engine.cancel());
  for (const action of ['pause','resume','reset'] as const) route(`/api/timer/${action}`, () => engine.timerAction(action));
  for (const action of ['add', 'set'] as const) app.post(`/api/timer/${action}`, auth, (req, res, next) => { try { const seconds = req.body?.seconds; if (!Number.isInteger(seconds)) throw new Error('seconds must be an integer'); res.json(engine.timerAction(action, seconds)); } catch (e) { next(e); } });
  const root = process.cwd();
  app.get('/theme.css', (_q, res, next) => { const theme = engine.profile.theme; if (!/^[a-z0-9_-]+$/i.test(theme)) return next(new Error('Invalid theme name')); res.sendFile(path.join(root, 'themes', `${theme}.css`)); });
  app.use('/widget', express.static(path.join(root, 'web/widget'))); app.use('/control', express.static(path.join(root, 'web/control')));
  app.get('/', (_q, r) => r.redirect('/control/'));
  app.use((error: unknown, _q: express.Request, r: express.Response, _n: express.NextFunction) => r.status(error instanceof Error && error.message.includes('OBS') ? 503 : 409).json({ error: error instanceof Error ? error.message : 'Unexpected error' }));
  return app;
}
