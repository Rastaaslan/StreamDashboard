import type { CalendarItem } from '../../contracts/src/index.js';

export const DEFAULT_UNPLANNED_START_WINDOW_MS = 30 * 60_000;
export const DEFAULT_UNPLANNED_PROVISIONAL_MS = 12 * 60 * 60_000;

function isLive(item: CalendarItem) {
  return !item.allDay && (item.category === 'live' || item.kind === 'LIVE');
}

export function findScheduledLiveForStart(
  items: CalendarItem[],
  now: number,
  windowMs = DEFAULT_UNPLANNED_START_WINDOW_MS,
) {
  return items.find(item =>
    isLive(item)
    && item.draft !== true
    && Date.parse(item.startAtUtc) <= now + windowMs
    && Date.parse(item.endAtUtc) > now);
}

export function findUnplannedDraft(items: CalendarItem[], trackedId?: string | null) {
  if (trackedId) {
    const exact = items.find(item => item.id === trackedId);
    if (exact?.draft === true && isLive(exact)) return exact;
  }
  return items.find(item =>
    isLive(item)
    && item.draft === true
    && item.ownership === 'LOCAL'
    && item.desiredPublication?.twitch !== true
    && item.desiredPublication?.google !== true);
}

export function createUnplannedLiveItem(input: {
  id: string;
  now: number;
  title?: string;
  twitchCategoryId?: string;
  provisionalMs?: number;
}): CalendarItem {
  const title = input.title?.trim().slice(0, 140) || 'Live non programmé';
  const provisionalMs = Math.max(60_000, input.provisionalMs ?? DEFAULT_UNPLANNED_PROVISIONAL_MS);
  return {
    id: input.id,
    localId: input.id,
    title,
    description: 'Créé automatiquement lors du démarrage d’un live non programmé.',
    startAtUtc: new Date(input.now).toISOString(),
    endAtUtc: new Date(input.now + provisionalMs).toISOString(),
    category: 'live',
    kind: 'LIVE',
    ownership: 'LOCAL',
    editable: true,
    draft: true,
    twitchCategoryId: input.twitchCategoryId,
    desiredPublication: { local: true, twitch: false, google: false },
    providers: {
      twitch: { status: 'not-published' },
      google: { status: 'not-published' },
    },
  };
}

export function finalizeUnplannedLive(item: CalendarItem, now: number) {
  if (!isLive(item) || item.draft !== true) throw new Error('Événement de live non programmé invalide.');
  const start = Date.parse(item.startAtUtc);
  const minimumEnd = Number.isFinite(start) ? start + 1000 : now;
  item.endAtUtc = new Date(Math.max(now, minimumEnd)).toISOString();
  item.draft = false;
  item.syncedAt = new Date(now).toISOString();
  return item;
}
