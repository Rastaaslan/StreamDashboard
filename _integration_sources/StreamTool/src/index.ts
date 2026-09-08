import 'dotenv/config'; import { loadProfile } from './config.js'; import { ObsClient } from './obs/obs-client.js'; import { SequenceEngine } from './sequences/engine.js'; import { createApp } from './api/app.js';
const host = process.env.HOST || '127.0.0.1'; const port = Number(process.env.PORT || 8787);
if (!['127.0.0.1','localhost','::1'].includes(host) && !process.env.API_TOKEN) throw new Error('API_TOKEN is required for a non-loopback HOST');
const profile = await loadProfile(); const obs = new ObsClient(process.env.OBS_WEBSOCKET_URL || 'ws://127.0.0.1:4455', process.env.OBS_WEBSOCKET_PASSWORD || ''); const engine = new SequenceEngine(profile, obs);
createApp(engine, process.env.API_TOKEN).listen(port, host, () => console.log(`[server] listening on http://${host}:${port}`)); void obs.connect();
