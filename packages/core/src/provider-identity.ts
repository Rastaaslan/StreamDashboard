import { publicationContent } from '../../../apps/mobile/shared/publication-content.js';
import type { CalendarItem } from '../../contracts/src/index.js';

/** A content edit or explicit retry is not evidence that a lost CREATE failed. */
export function assertProviderCreationCertain(item: CalendarItem, provider: 'twitch' | 'google') {
  if (item.providers?.[provider]?.uncertainCreate) {
    throw Object.assign(new Error('Création distante incertaine. Réconciliez son identité avant de republier.'), {
      code: 'PROVIDER_CREATE_UNCERTAIN',
    });
  }
}

/** Only explicit non-mutation evidence can release a persisted CREATE intent.
 * Timeouts, server failures and missing responses remain ambiguous.
 */
export function isDefinitiveCreateFailure(error: unknown): boolean {
  const failure = error as { mutationNotStarted?: boolean; status?: number } | null;
  return failure?.mutationNotStarted === true
    || [400, 401, 403, 404, 405, 410, 412, 413, 415, 422, 429].includes(failure?.status ?? 0);
}

/** Authorize one CREATE and record its uncertainty before calling the provider.
 * Only that invocation receives a copy without the marker. Edits/retries of the
 * durable item must wait for identity reconciliation if the response is lost.
 */
export async function createWithDurableIntent<T extends { id: string; revision?: string; fingerprint?: string; calendarId?: string }>(
  item: CalendarItem, provider: 'twitch' | 'google', persist: () => Promise<void>,
  create: (request: CalendarItem) => Promise<T>,
  prepare?: (request: CalendarItem) => { calendarId?: string } | Promise<{ calendarId?: string }>,
): Promise<T> {
  assertProviderCreationCertain(item, provider);
  const link = (item.providers ??= {})[provider] ??= { status: 'pending' };
  if (prepare) {
    const destination = await prepare(item);
    if (destination.calendarId) link.calendarId = destination.calendarId;
  }
  const { providers: _providers, conflict: _conflict, ...original } = item;
  link.uncertainCreate = { event: structuredClone(original) as unknown as Record<string, unknown>,
    publishedContent: publicationContent(item, provider) };
  await persist();
  const request = structuredClone(item);
  delete request.providers![provider]!.uncertainCreate;
  let result: T;
  try { result = await create(request); }
  catch (error) {
    if (isDefinitiveCreateFailure(error)) {
      delete link.uncertainCreate;
      await persist();
    }
    throw error;
  }
  if (!result.id) throw new Error('Création distante acceptée sans identité. Réconciliation requise.');
  // Another occurrence may persist the shared planning while this promise
  // resolves. Publish the identity before clearing uncertainty, with no await
  // between them, so no snapshot can observe neither protection.
  link.remoteId = result.id;
  link.remoteRevision = result.revision;
  link.fingerprint = result.fingerprint;
  link.calendarId = result.calendarId ?? link.calendarId;
  delete link.uncertainCreate;
  return result;
}
