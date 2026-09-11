export interface TwitchChannelMetadata { title: string; gameId: string }
export interface TwitchPreflightApi {
  getChannel(): Promise<TwitchChannelMetadata>;
  searchGame(exactName: string): Promise<Array<{ id: string; name: string }>>;
  updateChannel(value: TwitchChannelMetadata): Promise<void>;
}

export class TwitchPreflight {
  private preparedKey = '';

  constructor(private api: TwitchPreflightApi) {}

  async prepare(input: { eventId: string; title: string; category?: string; categoryId?: string }) {
    const category = input.category?.trim();
    const knownCategoryId = input.categoryId?.trim();
    if (!knownCategoryId && (!category || category.toLowerCase() === 'live')) {
      return { status: 'action-required' as const, error: 'Catégorie Twitch à choisir' };
    }

    let gameId = knownCategoryId;
    if (!gameId) {
      const games = await this.api.searchGame(category!);
      const game = games.find(value => value.name.localeCompare(category!, undefined, { sensitivity: 'accent' }) === 0);
      if (!game) return { status: 'action-required' as const, error: 'Catégorie Twitch introuvable' };
      gameId = game.id;
    }

    const desired = { title: input.title.trim(), gameId };
    const key = JSON.stringify([input.eventId, desired]);
    const current = await this.api.getChannel();
    // Idempotence is based on the real remote state. A previous successful key must
    // never hide a later out-of-band Twitch edit.
    if (current.title !== desired.title || current.gameId !== desired.gameId) await this.api.updateChannel(desired);
    this.preparedKey = key;
    return {
      status: 'ready' as const,
      ...desired,
      unchanged: current.title === desired.title && current.gameId === desired.gameId,
    };
  }

  invalidate() { this.preparedKey = ''; }
  get key() { return this.preparedKey; }
}
