import { describe, expect, it, vi } from 'vitest';
import { WizeBotAdapter } from '../integrations/wizebot/src/adapter.js';
import { WizeBotHttpTransport } from '../integrations/wizebot/src/http-transport.js';

describe('transport WizeBot', () => {
  it('authentifie la ressource fournie et récupère compte/statut', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ name: 'Rastaaslan', status: 'online' }), { status: 200 }));
    const adapter = new WizeBotAdapter({ apiBaseUrl: 'https://api.example/status', token: 'secret' }, new WizeBotHttpTransport(request as never));
    expect(await adapter.refresh()).toMatchObject({ status: 'CONNECTED', profile: { name: 'Rastaaslan', connected: true } });
    expect(request).toHaveBeenCalledWith('https://api.example/status', expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer secret' }) }));
  });
  it('distingue refus auth, panne réseau et état dégradé', async () => {
    const denied = new WizeBotAdapter({ apiBaseUrl: 'https://api.example', token: 'x' }, new WizeBotHttpTransport(async () => new Response('', { status: 401 })));
    expect(await denied.refresh()).toMatchObject({ status: 'ERROR', lastError: { code: 'WIZEBOT_AUTH_REFUSED' } });
    const offline = new WizeBotAdapter({ apiBaseUrl: 'https://api.example', token: 'x' }, { status: async () => ({ name: 'Bot', connected: false }) });
    expect(await offline.refresh()).toMatchObject({ status: 'DEGRADED', profile: { name: 'Bot', connected: false } });
    const network = new WizeBotAdapter({ apiBaseUrl: 'https://api.example', token: 'x' }, { status: async () => { throw new Error('network down'); } });
    expect(await network.refresh()).toMatchObject({ status: 'ERROR', lastError: { code: 'WIZEBOT_REQUEST_FAILED' } });
  });
  it('reste à configurer sans secret et accepte un refresh fiable', async () => {
    const transport = { status: vi.fn(async () => ({ name: 'Bot', connected: true })) };
    const adapter = new WizeBotAdapter(null, transport);
    expect((await adapter.refresh()).status).toBe('NOT_CONFIGURED');
    adapter.configure({ apiBaseUrl: 'https://api.example', token: 'secret' });
    expect((await adapter.refresh()).status).toBe('CONNECTED');
    expect((await adapter.refresh()).status).toBe('CONNECTED');
    expect(transport.status).toHaveBeenCalledTimes(2);
  });
});
