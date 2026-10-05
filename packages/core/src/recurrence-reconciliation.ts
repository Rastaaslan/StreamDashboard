/** Provider-neutral identities and a pure diff. Callers supply provider-relevant JSON content,
 * never remote metadata or the master's recurrence/exceptions, as the comparison payload. */
export interface OccurrenceIdentity { seriesId: string; occurrenceKey: string; provider: string }
export type ProjectionContent = null | boolean | number | string | ProjectionContent[] | { [key: string]: ProjectionContent };
export interface ExpectedMaterialization extends OccurrenceIdentity { content: ProjectionContent }
export interface MaterializedOccurrence extends ExpectedMaterialization { remoteId: string }
export interface ReconciliationScope { provider: string; seriesIds: readonly string[] }
export type ReconciliationAction =
  | { type: 'create'; identity: string; expected: ExpectedMaterialization }
  | { type: 'update'; identity: string; expected: ExpectedMaterialization; materialized: MaterializedOccurrence }
  | { type: 'delete'; identity: string; materialized: MaterializedOccurrence }
  | { type: 'noop'; identity: string; expected: ExpectedMaterialization; materialized: MaterializedOccurrence };

/** JSON tuple encoding is stable and cannot collide when identifiers contain separators. */
export function occurrenceIdentity(value: OccurrenceIdentity): string {
  if (![value.seriesId, value.occurrenceKey, value.provider].every(v => typeof v === 'string' && v.length > 0)) throw new Error('Invalid occurrence identity');
  return JSON.stringify([value.seriesId, value.occurrenceKey, value.provider]);
}
function canonical(value: ProjectionContent): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  throw new Error('Materialization content must be finite JSON');
}

/** expected is the COMPLETE desired set for the rolling window and scope. materialized is
 * the durable inventory owned by this projector, including entries that aged out. Unrelated
 * providers/series are ignored. An empty expected set intentionally deletes scoped inventory.
 * This computes a plan only: persist successful results before planning again. */
export function planRecurrenceReconciliation(
  expected: readonly ExpectedMaterialization[], materialized: readonly MaterializedOccurrence[], scope: ReconciliationScope,
): ReconciliationAction[] {
  if (!scope.provider || scope.seriesIds.some(id => !id)) throw new Error('Invalid reconciliation scope');
  const series = new Set(scope.seriesIds);
  const inScope = (value: OccurrenceIdentity) => value.provider === scope.provider && series.has(value.seriesId);
  const desired = new Map<string, ExpectedMaterialization>();
  const current = new Map<string, MaterializedOccurrence[]>();
  for (const value of expected) {
    if (!inScope(value)) throw new Error('Expected occurrence outside reconciliation scope');
    const identity = occurrenceIdentity(value);
    canonical(value.content);
    if (desired.has(identity)) throw new Error('Duplicate expected occurrence');
    desired.set(identity, value);
  }
  const remoteIds = new Set<string>();
  for (const value of materialized) {
    if (!inScope(value)) continue;
    const identity = occurrenceIdentity(value);
    canonical(value.content);
    if (!value.remoteId || remoteIds.has(value.remoteId)) throw new Error('Ambiguous materialized remote identity');
    remoteIds.add(value.remoteId);
    current.set(identity, [...(current.get(identity) ?? []), value]);
  }
  const actions: ReconciliationAction[] = [];
  for (const identity of [...new Set([...desired.keys(), ...current.keys()])].sort()) {
    const target = desired.get(identity);
    const copies = (current.get(identity) ?? []).sort((a, b) => {
      const aMatch = target && canonical(a.content) === canonical(target.content) ? 0 : 1;
      const bMatch = target && canonical(b.content) === canonical(target.content) ? 0 : 1;
      return aMatch - bMatch || (a.remoteId < b.remoteId ? -1 : a.remoteId > b.remoteId ? 1 : 0);
    });
    const keeper = target ? copies.shift() : undefined;
    for (const copy of copies) actions.push({ type: 'delete', identity, materialized: structuredClone(copy) });
    if (!target) continue;
    const snapshot = structuredClone(target);
    if (!keeper) actions.push({ type: 'create', identity, expected: snapshot });
    else actions.push({ type: canonical(keeper.content) === canonical(target.content) ? 'noop' : 'update', identity, expected: snapshot, materialized: structuredClone(keeper) });
  }
  return actions;
}
