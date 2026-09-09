const base = process.env.DASHBOARD_URL ?? 'http://127.0.0.1:47832';
const [healthResponse, stateResponse, capabilitiesResponse] = await Promise.all([
  fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(5000) }), fetch(`${base}/api/v1/state`, { signal: AbortSignal.timeout(5000) }), fetch(`${base}/api/v1/capabilities`, { signal: AbortSignal.timeout(5000) }),
]);
if (![healthResponse, stateResponse, capabilitiesResponse].every(response => response.ok)) throw new Error('API StreamDashboard indisponible.');
const health = await healthResponse.json() as { status?: string }; const state = await stateResponse.json() as Record<string, unknown>; const capabilities = await capabilitiesResponse.json() as { protocolVersion?: number };
for (const key of ['planning', 'obs', 'twitch', 'timer', 'health']) if (!(key in state)) throw new Error(`Champ absent : ${key}`);
if (health.status !== 'ready' || capabilities.protocolVersion !== 1) throw new Error('Protocole StreamDashboard incompatible.');
console.log('Smoke OK: API v1, état public et capacités disponibles');
