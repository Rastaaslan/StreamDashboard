import type { CalendarItem } from '../../../packages/contracts/src/index.js';
import { expandRecurringItems } from '../../../packages/core/src/recurrence.js';
import { assertTwitchRecurrence } from './recurrence.js';
// Invocation-local only: a persisted intent must never authorize another POST.
const prepared = new WeakSet<CalendarItem>();
/** Resolve provider dates before journaling, without changing the canonical anchor. */
export function twitchCreateRequest(item: CalendarItem, now = Date.now()) {
    if (item.deletionPending)
        throw Object.assign(new Error('Suppression en attente : création Twitch interdite.'), { mutationNotStarted: true });
    if (prepared.has(item))
        return item;
    assertTwitchRecurrence(item);
    const request = structuredClone(item);
    if (item.recurrence && Date.parse(item.startAtUtc) <= now) {
        const next = expandRecurringItems([item], { from: now, nextCount: 1, accept: value => Date.parse(value.startAtUtc) > now })[0];
        if (!next)
            throw Object.assign(new Error('Aucune occurrence Twitch future valide.'), { mutationNotStarted: true });
        request.startAtUtc = next.startAtUtc;
        request.endAtUtc = next.endAtUtc;
    }
    prepared.add(request);
    return request;
}
