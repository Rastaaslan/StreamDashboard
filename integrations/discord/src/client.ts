const API = 'https://discord.com/api/v10';
const TEXT_CHANNELS = new Set([0, 5]);
export interface DiscordGuild { id: string; name: string }
export interface DiscordChannel { id: string; name: string; type: number }

export class DiscordClient {
  constructor(private token: string, private fetchApi: typeof fetch = fetch, private timeoutMs = 8_000) {
    if (!token.trim()) throw new Error('Bot Discord non configuré.');
  }
  private async request(path: string, init: RequestInit = {}) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchApi(`${API}${path}`, { ...init, signal: controller.signal, headers: { ...init.headers, Authorization: `Bot ${this.token}` } });
      if (!response.ok) {
        const retry = response.headers.get('retry-after');
        if (response.status === 401) throw new Error('Token du bot Discord invalide.');
        if (response.status === 403) throw new Error('Le bot Discord n’a pas les permissions nécessaires.');
        if (response.status === 404) throw new Error('Serveur ou salon Discord introuvable.');
        if (response.status === 429) throw new Error(`Discord limite temporairement les publications${retry ? ` (${retry}s)` : ''}.`);
        throw new Error(`Discord est indisponible (${response.status}).`);
      }
      return response.status === 204 ? null : response.json();
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw new Error('Discord ne répond pas dans le délai imparti.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  async verify() { const value = await this.request('/users/@me') as Record<string, unknown>; return { id: String(value.id), name: String(value.global_name || value.username || 'Bot') }; }
  async guilds(): Promise<DiscordGuild[]> { const values = await this.request('/users/@me/guilds') as Array<Record<string, unknown>>; return values.slice(0, 200).map(value => ({ id: String(value.id), name: String(value.name).slice(0, 100) })); }
  async channels(guildId: string): Promise<DiscordChannel[]> { const values = await this.request(`/guilds/${guildId}/channels`) as Array<Record<string, unknown>>; return values.filter(value => TEXT_CHANNELS.has(Number(value.type))).slice(0, 500).map(value => ({ id: String(value.id), name: String(value.name).slice(0, 100), type: Number(value.type) })); }
  async ensureChannel(guildId: string, channelId: string) { const channel = (await this.channels(guildId)).find(value => value.id === channelId); if (!channel) throw new Error('Ce salon texte n’appartient pas au serveur Discord configuré.'); return channel; }
  async postPlanning(channelId: string, png: Uint8Array, filename: string, message: string) {
    const bytes = new Uint8Array(png.byteLength); bytes.set(png);
    const form = new FormData(); form.set('payload_json', JSON.stringify({ content: message })); form.set('files[0]', new Blob([bytes.buffer], { type: 'image/png' }), filename);
    const value = await this.request(`/channels/${channelId}/messages`, { method: 'POST', body: form }) as Record<string, unknown>;
    return { id: String(value.id), channelId };
  }
}
