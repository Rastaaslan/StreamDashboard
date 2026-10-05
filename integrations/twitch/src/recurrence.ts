import type { CalendarItem } from '../../../packages/contracts/src/index.js';

/** Twitch only represents unbounded weekly series, never local exceptions. */
export function assertTwitchRecurrence(item: Pick<CalendarItem, 'recurrence' | 'seriesId' | 'occurrenceKey' | 'providers' | 'twitchRecurring' | 'ownership'>) {
  const rule = item.recurrence;
  const fail = (): never => { throw Object.assign(new Error('Twitch : récurrence non représentable ; seules les séries weekly-1 sans fin ni exceptions sont acceptées.'), { mutationNotStarted: true }); };
  if (item.seriesId || item.occurrenceKey) fail();
  if (!rule) {
    if (item.ownership === 'LOCAL' && item.twitchRecurring && item.providers?.twitch?.projectionOwned && item.providers.twitch.projectionMode === 'native') fail();
    return;
  }
  if (rule.custom || ![undefined, 1, 2].includes(rule.version) || rule.frequency !== 'weekly' || rule.interval !== 1 || rule.until || Object.keys(rule.exceptions ?? {}).length || !rule.timeZone) fail();
  try { new Intl.DateTimeFormat('en', { timeZone: rule.timeZone }); } catch { fail(); }
}
