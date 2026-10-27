import { isTwitchTagsRejection } from '../../../integrations/twitch/src/client.js';
import { normalizeTags } from '../../../packages/core/src/tags.js';

export interface LegacyTwitchChannel {
  title: string;
  gameId: string;
  gameName: string;
  tags?: string[];
  tagsWarning?: string;
}
type TwitchChannelPatch = { title?: string; gameId?: string; tags?: string[] };

/** The v1 Twitch editor is still used by the preview and older mobile clients.
 * Keep this provider-specific patch independent of the v2 multistream form. */
export async function applyLegacyTwitchMetadata(
  input: unknown,
  previous: LegacyTwitchChannel,
  update: (patch: TwitchChannelPatch) => Promise<void>,
): Promise<LegacyTwitchChannel> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Informations Twitch invalides.');
  const value = input as Record<string, unknown>;
  for (const key of ['title', 'gameId', 'gameName']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error('Informations Twitch invalides.');
  }
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const gameId = typeof value.gameId === 'string' ? value.gameId.trim() : '';
  const gameName = typeof value.gameName === 'string' ? value.gameName.trim() : '';
  if (title.length > 140 || gameName.length > 140 || (gameId && !/^\d{1,30}$/.test(gameId))) throw new Error('Titre ou catégorie Twitch invalide.');
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.length > 1_000)) throw new Error('Tags Twitch invalides.');
  // Empty unchanged form fields do not block a tags-only edit, and are never
  // sent as an invalid empty title to Helix.
  const patch: TwitchChannelPatch = { ...(title ? { title } : {}), ...(gameId ? { gameId } : {}), ...(value.tags !== undefined ? { tags: normalizeTags(value.tags) } : {}) };
  if (!Object.keys(patch).length) throw new Error('Aucune information Twitch à modifier.');
  const next: LegacyTwitchChannel = { ...previous, ...(previous.tags ? { tags: [...previous.tags] } : {}) };
  let tagsRejected = false;
  try { await update(patch); }
  catch (error) {
    if (patch.tags === undefined || !isTwitchTagsRejection(error)) throw error;
    tagsRejected = true;
    const metadata = { ...(patch.title ? { title: patch.title } : {}), ...(patch.gameId ? { gameId: patch.gameId } : {}) };
    if (Object.keys(metadata).length) {
      await update(metadata);
      next.tagsWarning = 'Tags refusés par Twitch ; titre et catégorie appliqués. Corrige les tags puis réessaie.';
    } else next.tagsWarning = 'Tags refusés par Twitch. Corrige les tags puis réessaie.';
  }
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.gameId !== undefined) { next.gameId = patch.gameId; next.gameName = gameName || (patch.gameId === previous.gameId ? previous.gameName : ''); }
  if (patch.tags !== undefined && !tagsRejected) { next.tags = [...patch.tags]; delete next.tagsWarning; }
  return next;
}
