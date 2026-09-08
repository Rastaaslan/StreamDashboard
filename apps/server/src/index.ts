import express from 'express';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { ObsClient } from '../../../integrations/obs/src/client.js';
import type { CalendarItem, ChecklistItem, DashboardCommand, DashboardEvent, DashboardSettings, DashboardState, RunMode, TimerState } from '../../../packages/contracts/src/index.js';

const port = Number(process.env.PORT ?? 47832);
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const obs = new ObsClient();
const dataFile = path.resolve(process.env.DATA_FILE ?? 'data/dashboard.json');
interface LocalData { mode: RunMode; timer: TimerState; planning: CalendarItem[]; checklist: ChecklistItem[]; settings: DashboardSettings }
const defaults: LocalData = {
  mode: 'idle' as const,
  timer: { running: false, duration: 300, remaining: 300, deadline: null },
  planning: [] as CalendarItem[],
  checklist: [
    { id: 'obs', label: 'OBS connecté et scènes vérifiées', done: false },
    { id: 'audio', label: 'Micro, musique et alertes testés', done: false },
    { id: 'title', label: 'Titre, catégorie et notification prêts', done: false },
    { id: 'water', label: 'Eau et environnement prêts', done: false },
  ],
  settings: { streamerName: 'Streamer', accent: 'violet', confirmStop: true, obsUrl: process.env.OBS_URL ?? 'ws://127.0.0.1:4455' } as DashboardSettings,
};
let local: LocalData = structuredClone(defaults);
let errors: Array<{ at: string; message: string }> = [];

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.resolve('apps/web')));

async function load() {
  try { local = { ...local, ...JSON.parse(await readFile(dataFile, 'utf8')) }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logError(error); }
}
async function save() { await mkdir(path.dirname(dataFile), { recursive: true }); await writeFile(dataFile, JSON.stringify(local, null, 2)); }
function logError(error: unknown) { errors = [{ at: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) }, ...errors].slice(0, 30); }
function remaining() { return local.timer.running && local.timer.deadline ? Math.max(0, Math.ceil((local.timer.deadline - Date.now()) / 1000)) : local.timer.remaining; }
function snapshot(): DashboardState {
  local.timer.remaining = remaining();
  if (local.timer.running && local.timer.remaining === 0) { local.timer.running = false; local.timer.deadline = null; }
  const nextLive = local.planning.filter(x => (x.category === 'live' || x.kind === 'LIVE') && Date.parse(x.endAtUtc) > Date.now()).sort((a, b) => Date.parse(a.startAtUtc) - Date.parse(b.startAtUtc))[0] ?? null;
  return {
    at: new Date().toISOString(), ...local, obs: obs.state, nextLive,
    health: {
      dashboard: { ok: true, detail: 'API locale opérationnelle', reconnects: 0 },
      storage: { ok: true, detail: dataFile, reconnects: 0 },
      obs: { ok: obs.state.connected, detail: obs.state.connected ? 'WebSocket connecté' : 'OBS hors ligne — cockpit disponible', reconnects: obs.reconnectCount },
    },
  };
}
function broadcast() { const event: DashboardEvent = { type: 'state.updated', data: snapshot() }; const body = JSON.stringify(event); for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(body); }
async function changed() { await save(); broadcast(); return snapshot(); }

async function execute(command: DashboardCommand) {
  switch (command.type) {
    case 'mode.set': local.mode = command.mode; break;
    case 'timer.start': { const seconds = command.seconds ?? local.timer.remaining; local.timer.duration = seconds; local.timer.remaining = seconds; local.timer.running = true; local.timer.deadline = Date.now() + seconds * 1000; break; }
    case 'timer.pause': local.timer.remaining = remaining(); local.timer.running = false; local.timer.deadline = null; break;
    case 'timer.reset': local.timer.running = false; local.timer.remaining = local.timer.duration; local.timer.deadline = null; break;
    case 'timer.add': local.timer.remaining = remaining() + command.seconds; if (local.timer.running) local.timer.deadline = Date.now() + local.timer.remaining * 1000; break;
    case 'checklist.toggle': { const item = local.checklist.find(x => x.id === command.id); if (item) item.done = !item.done; break; }
    case 'checklist.reset': local.checklist.forEach(x => { x.done = false; }); break;
    case 'obs.scene': await obs.scene(command.scene); break;
    case 'obs.mute': await obs.mute(command.input, command.muted); break;
    case 'obs.volume': await obs.volume(command.input, command.volume); break;
    case 'obs.stream': await obs.stream(command.start); break;
    case 'obs.record': await obs.record(command.start); break;
  }
  return changed();
}

app.get('/api/state', (_req, res) => res.json(snapshot()));
app.post('/api/commands', async (req, res, next) => { try { res.json(await execute(req.body as DashboardCommand)); } catch (e) { next(e); } });
app.post('/api/planning', async (req, res, next) => { try {
  const input = req.body as Partial<CalendarItem>;
  if (!input.title || !input.startAtUtc || !input.endAtUtc || Date.parse(input.endAtUtc) <= Date.parse(input.startAtUtc)) return res.status(400).json({ error: 'Titre et période valides requis.' });
  local.planning.push({ id: randomUUID(), title: input.title, description: input.description ?? '', startAtUtc: input.startAtUtc, endAtUtc: input.endAtUtc, category: input.category ?? 'live' });
  res.status(201).json(await changed());
} catch (e) { next(e); } });
app.delete('/api/planning/:id', async (req, res, next) => { try { local.planning = local.planning.filter(x => x.id !== req.params.id); res.json(await changed()); } catch (e) { next(e); } });
app.put('/api/settings', async (req, res, next) => { try { local.settings = { ...local.settings, ...req.body }; res.json(await changed()); } catch (e) { next(e); } });
app.get('/api/diagnostics', (_req, res) => res.json({ state: snapshot(), errors, runtime: { node: process.version, pid: process.pid, uptime: process.uptime() } }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { logError(error); res.status(502).json({ error: error instanceof Error ? error.message : 'Erreur interne' }); });

wss.on('connection', ws => ws.send(JSON.stringify({ type: 'state.updated', data: snapshot() } satisfies DashboardEvent)));
await load();
void obs.connect();
setInterval(() => broadcast(), 1000).unref();
server.listen(port, '127.0.0.1', () => console.log(`StreamDashboard http://127.0.0.1:${port}`));
