// Exact, deterministic content identity. Provider status/revisions are excluded:
// those change during I/O without changing what the user asked to publish.
export function publicationContent(event, provider) {
  const fields = provider === 'twitch'
    ? [event.title || '', event.startAtUtc || '', event.endAtUtc || '', event.twitchCategoryId || '']
    : [event.title || '', event.description || '', event.startAtUtc || '', event.endAtUtc || '', Boolean(event.allDay)];
  return JSON.stringify([...fields, event.recurrence || null, event.seriesId || null, event.occurrenceKey || null,
    event.desiredPublication?.[provider] === true], (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}
