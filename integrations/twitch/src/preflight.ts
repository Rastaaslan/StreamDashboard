export interface TwitchChannelMetadata { title: string; gameId: string }
export interface TwitchPreflightApi { getChannel(): Promise<TwitchChannelMetadata>; searchGame(exactName: string): Promise<Array<{ id: string; name: string }>>; updateChannel(value: TwitchChannelMetadata): Promise<void> }
export class TwitchPreflight {
  private preparedKey = '';
  constructor(private api: TwitchPreflightApi) {}
  async prepare(input: { eventId: string; title: string; category?: string }) {
    const category = input.category?.trim();
    if (!category || category.toLowerCase() === 'live') return { status: 'action-required' as const, error: 'Catégorie Twitch à choisir' };
    const games = await this.api.searchGame(category); const game = games.find(x => x.name.localeCompare(category, undefined, { sensitivity: 'accent' }) === 0);
    if (!game) return { status: 'action-required' as const, error: 'Catégorie Twitch introuvable' };
    const desired = { title: input.title.trim(), gameId: game.id }, key = JSON.stringify([input.eventId, desired]);
    const current = await this.api.getChannel();
    if (this.preparedKey !== key && (current.title !== desired.title || current.gameId !== desired.gameId)) await this.api.updateChannel(desired);
    this.preparedKey = key; return { status: 'ready' as const, ...desired };
  }
  invalidate() { this.preparedKey = ''; }
}
