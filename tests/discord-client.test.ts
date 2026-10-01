import { describe, expect, it, vi } from 'vitest';
import { DiscordClient } from '../integrations/discord/src/client.js';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('client Discord serveur', () => {
  it('borne et sanitise les guildes et salons texte', async () => {
    const fetchApi = vi.fn().mockResolvedValueOnce(response([{ id: '1', name: 'Camp', secret: 'x' }])).mockResolvedValueOnce(response([{ id: '2', name: 'planning', type: 0, permission_overwrites: ['secret'] }, { id: '3', name: 'voice', type: 2 }]));
    const client = new DiscordClient('secret-token', fetchApi as any);
    expect(await client.guilds()).toEqual([{ id: '1', name: 'Camp' }]);
    expect(await client.channels('1')).toEqual([{ id: '2', name: 'planning', type: 0 }]);
    expect(JSON.stringify(await fetchApi.mock.calls.map(call => call[1]?.headers))).toContain('Bot secret-token');
  });

  it('joint exactement un PNG multipart et traduit les refus', async () => {
    const fetchApi = vi.fn().mockResolvedValueOnce(response({ id: 'message' }));
    const client = new DiscordClient('token', fetchApi as any);
    await client.postPlanning('2', new Uint8Array([137, 80, 78, 71]), 'planning.png', 'Planning');
    const form = fetchApi.mock.calls[0][1].body as FormData;
    expect([...form.keys()]).toEqual(['payload_json', 'files[0]']);
    const denied = new DiscordClient('token', vi.fn().mockResolvedValue(response({}, 403)) as any);
    await expect(denied.verify()).rejects.toThrow('permissions');
  });
});
