export interface TwitchChannelMetadata { title: string; gameId: string; tags?: string[] }
export interface TwitchPreflightApi {
  getChannel(): Promise<TwitchChannelMetadata>;
  searchGame(exactName: string): Promise<Array<{ id: string; name: string }>>;
  updateChannel(value: TwitchChannelMetadata): Promise<void>;
}

export class TwitchPreflight {
  private preparedKey = '';

  constructor(private api: TwitchPreflightApi) {}

  async prepare(input: { eventId: string; title: string; category?: string; categoryId?: string; tags?: string[] }) {
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

    const desired = { title: input.title.trim(), gameId, ...(input.tags !== undefined ? { tags: input.tags } : {}) };
    const key = JSON.stringify([input.eventId, desired]);
    const current = await this.api.getChannel();
    // Idempotence is based on the real remote state. A previous successful key must
    // never hide a later out-of-band Twitch edit.
    const tagsMatch = input.tags === undefined || JSON.stringify([...(current.tags ?? [])].sort()) === JSON.stringify([...input.tags].sort());
    const unchanged = current.title === desired.title && current.gameId === desired.gameId && tagsMatch;
    let tagsWarning: string | undefined;
    if (!unchanged) {
      try { await this.api.updateChannel(desired); }
      catch (error) {
        if (input.tags === undefined) throw error;
        await this.api.updateChannel({ title: desired.title, gameId });
        tagsWarning = 'Tags refusés par Twitch ; titre et catégorie appliqués.';
      }
    }
    this.preparedKey = key;
    return {
      status: 'ready' as const,
      ...desired,
      unchanged,
      tagsWarning,
    };
  }

  invalidate() { this.preparedKey = ''; }
  get key() { return this.preparedKey; }
}
