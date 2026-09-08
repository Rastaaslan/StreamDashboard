import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DateTime } from 'luxon';
import type { EventInput, EventPublication, EventTemplate, LiveRoutine, PlannerEvent } from '../domain/models';
import type { CalendarItem } from '../domain/calendar';
import { freeSlots } from '../domain/calendar';
import { actualDuration } from '../domain/cockpit';
import './style.css';

type Row = { event: PlannerEvent; google?: EventPublication; twitch?: EventPublication };
type Hub = { items: CalendarItem[]; rows: Row[]; warnings: string[]; fetchedAt: number; fromCache: boolean };
type Settings = {
  timezone: string;
  googleDefaultCalendarId: string;
  googleAvailabilityCalendarIds: string[];
  twitchClientId: string;
  availabilityLocal: boolean;
  availabilityGoogle: boolean;
  availabilityTwitch: boolean;
  onboardingDone: boolean;
  googleConfigured: boolean;
  googleConnected: boolean;
  twitchConfigured: boolean;
  twitchConnected: boolean;
  googleAccount?: string;
  twitchAccount?: string;
  broadcasterId?: string;
  refreshMinutes: 0 | 5 | 15 | 30;
  liveBufferBefore: number;
  liveBufferAfter: number;
  personalBufferBefore: number;
  personalBufferAfter: number;
  notificationsEnabled: boolean;
  liveReminderMinutes: number;
  personalReminderMinutes: number;
  closeToTray: boolean;
  launchAtStartup: boolean;
};
type Category = { id: string; name: string; boxArtUrl: string };
type GoogleCalendar = { id: string; summary: string; primary?: boolean; backgroundColor?: string };
type DeviceState = { deviceCode: string; userCode: string; verificationUri: string; expiresAt: number; interval: number };
type Prefill = { start: DateTime; end: DateTime };
type Preview = {
  availability: {
    status: 'AVAILABLE' | 'CONFLICT' | 'INCOMPLETE';
    hash: string;
    errors: string[];
    conflicts: { id: string; title: string; source: string; startAtUtc: string; endAtUtc: string }[];
  };
};

type RoutineStep = LiveRoutine['steps'][number];
type CockpitTarget = { id: string; name: string; type: RoutineStep['type']; enabled: boolean };
type CockpitData = {
  routines: LiveRoutine[];
  participants: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  targets: CockpitTarget[];
};

const defaults: Settings = {
  timezone: 'Europe/Paris',
  googleDefaultCalendarId: 'primary',
  googleAvailabilityCalendarIds: ['primary'],
  twitchClientId: '',
  availabilityLocal: true,
  availabilityGoogle: true,
  availabilityTwitch: true,
  onboardingDone: false,
  googleConfigured: false,
  googleConnected: false,
  twitchConfigured: false,
  twitchConnected: false,
  refreshMinutes: 15,
  liveBufferBefore: 30,
  liveBufferAfter: 15,
  personalBufferBefore: 0,
  personalBufferAfter: 0,
  notificationsEnabled: true,
  liveReminderMinutes: 30,
  personalReminderMinutes: 60,
  closeToTray: false,
  launchAtStartup: false,
};

function providerBadge(publication: EventPublication | undefined, name: string) {
  if (publication?.status === 'SYNCED') return `✓ ${name}`;
  if (publication?.status === 'ERROR' || publication?.status === 'REAUTH_REQUIRED') return `⚠ ${name}`;
  if (publication?.status === 'PUBLISHING' || publication?.status === 'PENDING') return `… ${name}`;
  return null;
}

function EventForm({ editing, prefill, settings, onDone, onCancel }: {
  editing?: PlannerEvent;
  prefill?: Prefill;
  settings: Settings;
  onDone: () => void;
  onCancel: () => void;
}) {
  const zone = editing?.timezone ?? settings.timezone;
  const initialStart = editing
    ? DateTime.fromISO(editing.startAtUtc).setZone(zone)
    : prefill?.start ?? DateTime.now().setZone(zone).plus({ hours: 1 }).startOf('hour');
  const initialEnd = editing
    ? DateTime.fromISO(editing.endAtUtc).setZone(zone)
    : prefill?.end ?? initialStart.plus({ hours: 2 });
  const [twitch, setTwitch] = useState(editing?.syncTwitch ?? false);
  const [query, setQuery] = useState(editing?.twitchCategoryName ?? '');
  const [selected, setSelected] = useState<Category | undefined>(editing?.twitchCategoryId ? {
    id: editing.twitchCategoryId,
    name: editing.twitchCategoryName ?? '',
    boxArtUrl: editing.twitchCategoryBoxArtUrl ?? '',
  } : undefined);
  const [categories, setCategories] = useState<Category[]>([]);
  const [preview, setPreview] = useState<Preview>();
  const [input, setInput] = useState<EventInput>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checklist, setChecklist] = useState(editing?.checklist ?? []);
  const [newChecklistItem, setNewChecklistItem] = useState('');

  useEffect(() => {
    if (!twitch || query.trim().length < 2 || selected?.name === query) return;
    const timer = setTimeout(() => {
      window.damplanner.categories(query).then(setCategories).catch((reason: Error) => setError(reason.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, twitch, selected]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const data = new FormData(event.currentTarget);
    const start = DateTime.fromISO(`${data.get('date')}T${data.get('start')}`, { zone });
    const rawEnd = DateTime.fromISO(`${data.get('date')}T${data.get('end')}`, { zone });
    const end = rawEnd <= start ? rawEnd.plus({ days: 1 }) : rawEnd;
    const value: EventInput = {
      kind: data.get('kind') as 'LIVE' | 'PERSONAL',
      title: String(data.get('title')),
      description: String(data.get('description') ?? ''),
      startAtUtc: start.toUTC().toISO()!,
      endAtUtc: end.toUTC().toISO()!,
      timezone: zone,
      syncGoogle: data.has('google'),
      syncTwitch: data.has('twitch'),
      googleCalendarId: data.has('google') ? String(data.get('calendar') || settings.googleDefaultCalendarId) : null,
      twitchTitle: data.has('twitch') ? String(data.get('twitchTitle')) : null,
      twitchCategoryId: data.has('twitch') ? selected?.id ?? null : null,
      twitchCategoryName: data.has('twitch') ? selected?.name ?? null : null,
      twitchCategoryBoxArtUrl: data.has('twitch') ? selected?.boxArtUrl ?? null : null,
      status: data.has('draft') ? 'DRAFT' : 'PUBLISHED',
      bufferBeforeMinutes: editing?.bufferBeforeMinutes ?? null,
      bufferAfterMinutes: editing?.bufferAfterMinutes ?? null,
      checklist,
      recurrence: editing?.recurrence ?? null,
      lifecycleState: editing?.lifecycleState ?? 'PLANNED',
      actualStartAt: editing?.actualStartAt ?? null,
      actualEndAt: editing?.actualEndAt ?? null,
      routineId: editing?.routineId ?? null,
      routineSteps: editing?.routineSteps ?? [],
      tags: editing?.tags ?? [],
      participantIds: editing?.participantIds ?? [],
      travelBeforeMinutes: editing?.travelBeforeMinutes ?? 0,
      travelAfterMinutes: editing?.travelAfterMinutes ?? 0,
      postLiveMood: editing?.postLiveMood ?? null,
      postLiveNote: editing?.postLiveNote ?? '',
      highlights: editing?.highlights ?? [],
    };
    try {
      setBusy(true);
      const result = await window.damplanner.preview(value, editing?.id) as Preview;
      setInput(value);
      setPreview(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function save(overrideHash?: string) {
    if (!input) return;
    try {
      setBusy(true);
      if (editing && ((editing.syncGoogle && !input.syncGoogle) || (editing.syncTwitch && !input.syncTwitch))) {
        if (!confirm('La publication distante désactivée sera supprimée. Continuer ?')) return;
      }
      await window.damplanner.save(input, editing?.id, overrideHash);
      onDone();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  function addChecklistItem() {
    const label = newChecklistItem.trim();
    if (!label) return;
    setChecklist([...checklist, { id: crypto.randomUUID(), label, done: false }]);
    setNewChecklistItem('');
  }

  return <section className="panel">
    <div className="titlebar">
      <div><small>ÉVÉNEMENT</small><h1>{editing ? 'Modifier' : 'Nouvel événement'}</h1></div>
      <button onClick={onCancel}>Fermer</button>
    </div>
    <form className="event-form" onSubmit={submit}>
      <div className="two">
        <label>Type<select name="kind" defaultValue={editing?.kind ?? 'LIVE'}><option value="LIVE">Live</option><option value="PERSONAL">Personnel</option></select></label>
        <label>Titre<input name="title" required defaultValue={editing?.title} /></label>
      </div>
      <label>Description privée<textarea name="description" defaultValue={editing?.description} /></label>
      <div className="three">
        <label>Date<input name="date" type="date" required defaultValue={initialStart.toISODate()!} /></label>
        <label>Début<input name="start" type="time" required defaultValue={initialStart.toFormat('HH:mm')} /></label>
        <label>Fin<input name="end" type="time" required defaultValue={initialEnd.toFormat('HH:mm')} /></label>
      </div>
      <div className="syncbox">
        <label><input name="draft" type="checkbox" defaultChecked={editing?.status === 'DRAFT'} /> Enregistrer comme brouillon</label>
        <label><input name="google" type="checkbox" defaultChecked={editing?.syncGoogle} /> Google Calendar</label>
        <select name="calendar" defaultValue={editing?.googleCalendarId ?? settings.googleDefaultCalendarId}>
          {[...new Set([settings.googleDefaultCalendarId, ...settings.googleAvailabilityCalendarIds])].map(calendar => <option key={calendar} value={calendar}>{calendar}</option>)}
        </select>
        <label><input name="twitch" type="checkbox" checked={twitch} onChange={event => setTwitch(event.target.checked)} /> Twitch</label>
        {twitch && <div className="twitch-fields">
          <label>Titre public Twitch<input name="twitchTitle" required defaultValue={editing?.twitchTitle ?? ''} /></label>
          <label>Catégorie Twitch<input value={query} onChange={event => { setQuery(event.target.value); setSelected(undefined); }} required placeholder="Rechercher une catégorie…" /></label>
          {categories.length > 0 && !selected && <div className="suggestions">{categories.map(category => <button type="button" key={category.id} onClick={() => { setSelected(category); setQuery(category.name); setCategories([]); }}><img src={category.boxArtUrl} />{category.name}</button>)}</div>}
        </div>}
      </div>
      <fieldset>
        <legend>Checklist de préparation</legend>
        {checklist.map(item => <label key={item.id} className="check-row"><input type="checkbox" checked={item.done} onChange={event => setChecklist(checklist.map(value => value.id === item.id ? { ...value, done: event.target.checked } : value))} />{item.label}<button type="button" onClick={() => setChecklist(checklist.filter(value => value.id !== item.id))}>×</button></label>)}
        <div className="actions"><input aria-label="Nouvel élément checklist" value={newChecklistItem} onChange={event => setNewChecklistItem(event.target.value)} placeholder="Ajouter une étape…" /><button type="button" onClick={addChecklistItem}>Ajouter</button></div>
      </fieldset>
      {error && <p className="error">{error}</p>}
      <div className="actions"><button type="button" onClick={onCancel}>Annuler</button><button className="primary" disabled={busy}>{busy ? 'Vérification…' : 'Prévisualiser et vérifier'}</button></div>
    </form>
    {preview && <div className="modal" role="dialog" aria-modal="true"><div>
      <h2>{preview.availability.status === 'AVAILABLE' ? 'Événement prêt à enregistrer' : preview.availability.status === 'CONFLICT' ? 'Chevauchement détecté' : 'Vérification incomplète'}</h2>
      {preview.availability.errors.map(message => <p className="warning" key={message}>{message}</p>)}
      {preview.availability.conflicts.map(conflict => <article className="conflict" key={`${conflict.source}:${conflict.id}`}><b>{conflict.title}</b><span>{conflict.source} · {DateTime.fromISO(conflict.startAtUtc).setZone(zone).toFormat('HH:mm')}–{DateTime.fromISO(conflict.endAtUtc).setZone(zone).toFormat('HH:mm')}</span></article>)}
      <div className="actions"><button onClick={() => setPreview(undefined)}>Modifier le créneau</button><button className="primary" onClick={() => save(preview.availability.status === 'AVAILABLE' ? undefined : preview.availability.hash)}>{preview.availability.status === 'AVAILABLE' ? 'Enregistrer' : preview.availability.status === 'CONFLICT' ? 'Valider quand même' : 'Enregistrer hors ligne'}</button></div>
    </div></div>}
  </section>;
}

function ItemCard({ item, onEdit, onReload, onPrepare }: { item: CalendarItem; onEdit: (id: string) => void; onReload: () => void; onPrepare?: (id: string) => void }) {
  async function adopt() {
    if (!item.externalId || !confirm(`Gérer « ${item.title} » dans DamPlanner ?`)) return;
    await window.damplanner.adopt({ id: item.externalId, calendarId: item.calendarId });
    onReload();
  }
  async function publishDraft() {
    if (!item.localEventId) return;
    const first = await window.damplanner.publish(item.localEventId) as { requiresConfirmation?: boolean; availability?: { hash: string } };
    if (first.requiresConfirmation && first.availability && confirm('Un conflit a été détecté. Publier quand même ?')) {
      await window.damplanner.publish(item.localEventId, first.availability.hash);
    }
    onReload();
  }
  async function remove() {
    if (!item.localEventId || !confirm(`Supprimer « ${item.title} » et ses publications distantes ?`)) return;
    await window.damplanner.remove(item.localEventId);
    onReload();
  }
  async function retry(provider: 'GOOGLE' | 'TWITCH') {
    if (!item.localEventId) return;
    await window.damplanner.retry(item.localEventId, provider);
    onReload();
  }

  const lifecycle = item.lifecycleState ?? (item.kind === 'LIVE' ? 'PLANNED' : undefined);
  const lifecycleLabels = {
    PLANNED: ['○', 'PLANIFIÉ'],
    PREPARING: ['◐', 'EN PRÉPARATION'],
    READY: ['●', 'PRÊT'],
    LIVE: ['🔴', 'EN LIVE'],
    FINISHED: ['✓', 'TERMINÉ'],
    CANCELLED: ['✕', 'ANNULÉ'],
  } as const;
  const lifecycleLabel = lifecycle ? lifecycleLabels[lifecycle] : undefined;
  const prepareLabel = lifecycle === 'FINISHED' ? 'Voir le bilan'
    : lifecycle === 'LIVE' ? '🔴 Ouvrir le live'
    : lifecycle === 'PREPARING' || lifecycle === 'READY' ? 'Ouvrir le Cockpit'
    : 'Préparer le live';

  return <article className={`event ${item.source.toLowerCase()} ${item.draft ? 'draft' : ''} ${lifecycle ? `lifecycle-${lifecycle.toLowerCase()}` : ''}`}>
    <time>{item.allDay ? 'Toute la journée' : `${DateTime.fromISO(item.startAtUtc).toFormat('HH:mm')}–${DateTime.fromISO(item.endAtUtc).toFormat('HH:mm')}`}</time>
    <span className={`tag ${(item.kind ?? item.source).toLowerCase()}`}>{item.kind === 'PERSONAL' ? 'PERSO' : item.kind ?? item.source}</span>
    <div>
      <strong>{item.title}</strong>
      <small>{item.calendarName ?? (item.source === 'DAMPLANNER' ? 'DamPlanner' : item.source)}</small>
      {item.metadata?.conflictAccepted === 'true' && <small className="accepted">Chevauchement accepté</small>}
      {item.kind === 'LIVE' && lifecycleLabel && <b className={`lifecycle-inline lifecycle-${lifecycle!.toLowerCase()}`}>{lifecycleLabel[0]} {lifecycleLabel[1]}</b>}
      {lifecycle === 'FINISHED' && item.actualStartAt && item.actualEndAt && <small>Réel : {DateTime.fromISO(item.actualStartAt).toFormat('HH:mm')} → {DateTime.fromISO(item.actualEndAt).toFormat('HH:mm')} · {actualDuration(item.actualStartAt, item.actualEndAt).label}</small>}
    </div>
    <div className="statuses">
      {item.draft ? <span>Brouillon</span> : <>
        {providerBadge(item.google, 'Google') && <span>{providerBadge(item.google, 'Google')}</span>}
        {providerBadge(item.twitch, 'Twitch') && <span>{providerBadge(item.twitch, 'Twitch')}</span>}
        {item.source !== 'DAMPLANNER' && <span>{item.source === 'GOOGLE' ? 'Google seul' : 'Twitch seul'}</span>}
      </>}
    </div>
    <div className="row-actions">
      {item.kind === 'LIVE' && item.editable && onPrepare && lifecycle !== 'CANCELLED' && <button className="primary" onClick={() => onPrepare(item.localEventId!)}>{prepareLabel}</button>}
      {item.editable && <button onClick={() => onEdit(item.localEventId!)}>Modifier</button>}
      {item.draft && <button onClick={publishDraft}>Publier</button>}
      {item.editable && <button onClick={async () => { const start = DateTime.fromISO(item.startAtUtc).plus({ weeks: 1 }); const end = DateTime.fromISO(item.endAtUtc).plus({ weeks: 1 }); await window.damplanner.duplicate(item.localEventId!, start.toISO()!, end.toISO()!); onReload(); }}>Dupliquer</button>}
      {item.google?.status === 'ERROR' && <button onClick={() => retry('GOOGLE')}>Réessayer Google</button>}
      {item.twitch?.status === 'ERROR' && <button onClick={() => retry('TWITCH')}>Réessayer Twitch</button>}
      {item.editable && <button onClick={remove}>Supprimer</button>}
      {!item.editable && item.source === 'GOOGLE' && <button onClick={adopt}>Gérer dans DamPlanner</button>}
    </div>
  </article>;
}

function layoutTimedItems(items: CalendarItem[], zone: string) {
  const sorted = [...items].sort((a, b) => a.startAtUtc.localeCompare(b.startAtUtc));
  const columnEnds: number[] = [];
  const assigned = sorted.map(item => {
    const start = DateTime.fromISO(item.startAtUtc).setZone(zone).toMillis();
    const end = DateTime.fromISO(item.endAtUtc).setZone(zone).toMillis();
    let column = columnEnds.findIndex(value => value <= start);
    if (column < 0) column = columnEnds.length;
    columnEnds[column] = end;
    return { item, column };
  });
  const total = Math.max(1, columnEnds.length);
  return assigned.map(value => ({ ...value, total }));
}

function Agenda({ items, zone, onCreate, onEdit, onMove, onPrepare }: {
  items: CalendarItem[];
  zone: string;
  onCreate: (prefill: Prefill) => void;
  onEdit: (id: string) => void;
  onMove: (item: CalendarItem, start: string, end: string) => void;
  onPrepare: (id: string) => void;
}) {
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(DateTime.now().setZone(zone));
  const begin = mode === 'week' ? anchor.startOf('week') : anchor.startOf('month');
  const days = Array.from({ length: mode === 'week' ? 7 : begin.daysInMonth! }, (_, index) => begin.plus({ days: index }));

  function openItem(item: CalendarItem) {
    if (!item.editable || !item.localEventId) return;
    if (item.kind === 'LIVE' && ['PREPARING', 'READY', 'LIVE', 'FINISHED'].includes(item.lifecycleState ?? '')) onPrepare(item.localEventId);
    else onEdit(item.localEventId);
  }

  function createAtPointer(day: DateTime, event: React.MouseEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const minutes = Math.max(0, Math.min(23 * 60 + 30, Math.round(((event.clientY - box.top) / box.height) * 48) * 30));
    const start = day.startOf('day').plus({ minutes });
    onCreate({ start, end: start.plus({ hours: 1 }) });
  }

  function dropAtPointer(day: DateTime, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain');
    const item = items.find(value => value.id === id);
    if (!item?.editable || item.lifecycleState === 'FINISHED') return;
    const box = event.currentTarget.getBoundingClientRect();
    const minutes = Math.max(0, Math.min(23 * 60 + 30, Math.round(((event.clientY - box.top) / box.height) * 48) * 30));
    const duration = Date.parse(item.endAtUtc) - Date.parse(item.startAtUtc);
    const start = day.startOf('day').plus({ minutes });
    onMove(item, start.toUTC().toISO()!, start.plus({ milliseconds: duration }).toUTC().toISO()!);
  }

  function resize(item: CalendarItem, event: React.PointerEvent<HTMLSpanElement>) {
    if (!item.editable || item.lifecycleState === 'FINISHED') return;
    event.preventDefault();
    event.stopPropagation();
    const originY = event.clientY;
    const originalEnd = DateTime.fromISO(item.endAtUtc);
    const start = DateTime.fromISO(item.startAtUtc);
    const onUp = (pointer: PointerEvent) => {
      window.removeEventListener('pointerup', onUp);
      const deltaMinutes = Math.round((pointer.clientY - originY) / 12) * 15;
      const nextEnd = originalEnd.plus({ minutes: deltaMinutes });
      if (nextEnd.diff(start, 'minutes').minutes >= 30) onMove(item, item.startAtUtc, nextEnd.toUTC().toISO()!);
    };
    window.addEventListener('pointerup', onUp, { once: true });
  }

  return <section>
    <div className="calendar-toolbar">
      <div className="actions"><button onClick={() => setAnchor(anchor.minus({ [mode === 'week' ? 'weeks' : 'months']: 1 }))}>‹ Précédent</button><button onClick={() => setAnchor(DateTime.now().setZone(zone))}>Aujourd’hui</button><button onClick={() => setAnchor(anchor.plus({ [mode === 'week' ? 'weeks' : 'months']: 1 }))}>Suivant ›</button></div>
      <h1>{begin.setLocale('fr').toFormat(mode === 'week' ? "'Semaine du' d LLLL" : 'LLLL yyyy')}</h1>
      <div className="actions"><button className={mode === 'week' ? 'active' : ''} onClick={() => setMode('week')}>Semaine</button><button className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}>Mois</button></div>
    </div>
    {mode === 'week' ? <div className="week-calendar">
      <div className="all-day-row">{days.map(day => <div className="all-day-cell" key={day.toISODate()}><b>{day.setLocale('fr').toFormat('ccc d')}</b>{items.filter(item => item.allDay && item.startAtUtc < day.plus({ days: 1 }).startOf('day').toUTC().toISO()! && item.endAtUtc > day.startOf('day').toUTC().toISO()!).map(item => <span className={`all-day-event ${item.source.toLowerCase()}`} key={item.id}>{item.title}</span>)}</div>)}</div>
      <div className="week-scroll"><div className="time-labels">{Array.from({ length: 24 }, (_, hour) => <span key={hour} style={{ top: `${hour * 48}px` }}>{String(hour).padStart(2, '0')}:00</span>)}</div><div className="week-columns">{days.map(day => {
        const timed = items.filter(item => !item.allDay && DateTime.fromISO(item.startAtUtc).setZone(zone).toISODate() === day.toISODate());
        return <div className={`time-track ${day.hasSame(DateTime.now().setZone(zone), 'day') ? 'current' : ''}`} key={day.toISODate()} onDoubleClick={event => createAtPointer(day, event)} onDragOver={event => event.preventDefault()} onDrop={event => dropAtPointer(day, event)}>
          {layoutTimedItems(timed, zone).map(({ item, column, total }) => {
            const start = DateTime.fromISO(item.startAtUtc).setZone(zone);
            const end = DateTime.fromISO(item.endAtUtc).setZone(zone);
            const top = (start.hour * 60 + start.minute) / 30 * 24;
            const height = Math.max(24, end.diff(start, 'minutes').minutes / 30 * 24);
            const draggable = item.editable && item.lifecycleState !== 'FINISHED';
            return <div key={item.id} className={`calendar-event ${item.source.toLowerCase()} ${item.draft ? 'draft' : ''} ${item.lifecycleState ? `lifecycle-${item.lifecycleState.toLowerCase()}` : ''}`} draggable={draggable} onDragStart={event => event.dataTransfer.setData('text/plain', item.id)} onClick={event => { event.stopPropagation(); openItem(item); }} style={{ top: `${top}px`, height: `${height}px`, left: `${column * (100 / total)}%`, width: `${100 / total}%`, borderLeftColor: item.color }} role="button" tabIndex={item.editable ? 0 : -1}>
              <time>{start.toFormat('HH:mm')}</time> {item.lifecycleState === 'LIVE' ? '🔴 ' : item.lifecycleState === 'FINISHED' ? '✓ ' : ''}{item.title}{draggable && <span className="resize-handle" onPointerDown={event => resize(item, event)} />}
            </div>;
          })}
        </div>;
      })}</div></div>
    </div> : <div className="month-calendar">{days.map(day => {
      const dayItems = items.filter(item => item.startAtUtc < day.plus({ days: 1 }).startOf('day').toUTC().toISO()! && item.endAtUtc > day.startOf('day').toUTC().toISO()!);
      return <div className={`month-day ${day.hasSame(DateTime.now().setZone(zone), 'day') ? 'current' : ''}`} key={day.toISODate()} onDoubleClick={() => onCreate({ start: day.set({ hour: 12 }), end: day.set({ hour: 13 }) })} onDragOver={event => event.preventDefault()} onDrop={event => { const id = event.dataTransfer.getData('text/plain'); const item = items.find(value => value.id === id); if (!item?.editable || item.lifecycleState === 'FINISHED') return; const oldStart = DateTime.fromISO(item.startAtUtc).setZone(zone); const duration = Date.parse(item.endAtUtc) - Date.parse(item.startAtUtc); const start = day.set({ hour: oldStart.hour, minute: oldStart.minute }); onMove(item, start.toUTC().toISO()!, start.plus({ milliseconds: duration }).toUTC().toISO()!); }}><b>{day.day}</b>{dayItems.slice(0, 5).map(item => <div draggable={item.editable && item.lifecycleState !== 'FINISHED'} onDragStart={event => event.dataTransfer.setData('text/plain', item.id)} onClick={() => openItem(item)} className={`month-event ${item.source.toLowerCase()} ${item.lifecycleState ? `lifecycle-${item.lifecycleState.toLowerCase()}` : ''}`} key={item.id}>{item.allDay ? '' : `${DateTime.fromISO(item.startAtUtc).setZone(zone).toFormat('HH:mm')} `}{item.lifecycleState === 'LIVE' ? '🔴 ' : item.lifecycleState === 'FINISHED' ? '✓ ' : ''}{item.title}</div>)}</div>;
    })}</div>}
    <p className="hint">Double-cliquez un créneau pour créer. Déplacez ou redimensionnez uniquement les événements gérés par DamPlanner.</p>
  </section>;
}

function Today({ items, zone, onEdit, onReload, onPrepare }: { items: CalendarItem[]; zone: string; onEdit: (id: string) => void; onReload: () => void; onPrepare: (id: string) => void }) {
  const now = DateTime.now().setZone(zone);
  const today = now.toISODate()!;
  const daily = items.filter(item => item.startAtUtc < now.plus({ days: 1 }).startOf('day').toUTC().toISO()! && item.endAtUtc > now.startOf('day').toUTC().toISO()!);
  const next = items.find(item => item.startAtUtc > now.toUTC().toISO()! && !(item.kind === 'LIVE' && ['FINISHED', 'CANCELLED'].includes(item.lifecycleState ?? 'PLANNED')));
  const activeLive = items.find(item => item.kind === 'LIVE' && item.lifecycleState === 'LIVE');
  const live = items.find(item => item.kind === 'LIVE' && !['FINISHED', 'CANCELLED'].includes(item.lifecycleState ?? 'PLANNED') && item.startAtUtc > now.toUTC().toISO()!);
  const finished = items.find(item => item.kind === 'LIVE' && item.lifecycleState === 'FINISHED' && item.actualStartAt && item.actualEndAt && DateTime.fromISO(item.actualEndAt).setZone(zone).hasSame(now, 'day'));
  const free = freeSlots(items, today, zone, 30);

  return <>
    <div className="hero"><div><small>AUJOURD’HUI</small><h1>{now.setLocale('fr').toFormat('cccc d LLLL')}</h1></div></div>
    <div className="dashboard">
      <section className="metric"><small>PROCHAIN ÉVÉNEMENT</small><h2>{next ? `${DateTime.fromISO(next.startAtUtc).setZone(zone).toFormat('HH:mm')} — ${next.title}` : 'Journée libre'}</h2>{next && <p>dans {Math.max(0, Math.round(DateTime.fromISO(next.startAtUtc).diff(now, 'minutes').minutes))} min</p>}</section>
      <section className="metric">
        <small>{activeLive ? '🔴 EN LIVE MAINTENANT' : finished && !live ? '✓ LIVE TERMINÉ AUJOURD’HUI' : 'PROCHAIN LIVE'}</small>
        <h2>{activeLive ? `${activeLive.title}${activeLive.actualStartAt ? ` — depuis ${DateTime.fromISO(activeLive.actualStartAt).setZone(zone).toFormat('HH:mm')}` : ''}` : live ? `${DateTime.fromISO(live.startAtUtc).setZone(zone).toFormat('HH:mm')} — ${live.title}` : finished ? `${finished.title} · ${actualDuration(finished.actualStartAt!, finished.actualEndAt!).label}` : 'Aucun live prévu'}</h2>
        {(activeLive || live) && <button className="primary" onClick={() => onPrepare((activeLive ?? live)!.localEventId!)}>Ouvrir le Cockpit</button>}
        {live && !activeLive && <p>Préparation : {live.metadata?.checklist ?? '0/0'}</p>}
      </section>
      <section className="metric wide"><small>TEMPS LIBRE</small>{free.slice(0, 4).map(slot => <p key={slot.startAtUtc}>{DateTime.fromISO(slot.startAtUtc).setZone(zone).toFormat('HH:mm')} → {DateTime.fromISO(slot.endAtUtc).setZone(zone).toFormat('HH:mm')} · {Math.round(slot.minutes)} min</p>)}</section>
    </div>
    <h2>Événements du jour</h2>
    {daily.map(item => <ItemCard key={item.id} item={item} onEdit={onEdit} onReload={onReload} onPrepare={onPrepare} />)}
  </>;
}

function lifecycleView(event: PlannerEvent) {
  const state = event.lifecycleState ?? 'PLANNED';
  const values = {
    PLANNED: ['○', 'PLANIFIÉ'],
    PREPARING: ['◐', 'EN PRÉPARATION'],
    READY: ['●', 'PRÊT'],
    LIVE: ['🔴', 'EN LIVE'],
    FINISHED: ['✓', 'TERMINÉ'],
    CANCELLED: ['✕', 'ANNULÉ'],
  } as const;
  const [icon, label] = values[state];
  const time = state === 'LIVE' && event.actualStartAt
    ? ` — depuis ${DateTime.fromISO(event.actualStartAt).setZone(event.timezone).toFormat('HH:mm')}`
    : state === 'FINISHED' && event.actualEndAt
      ? ` — ${DateTime.fromISO(event.actualEndAt).setZone(event.timezone).toFormat('HH:mm')}`
      : '';
  return { state, icon, label, time };
}

function Cockpit({ event, onReload, onClose, onComplete }: { event: PlannerEvent; onReload: () => Promise<void>; onClose: () => void; onComplete: (message: string) => Promise<void> }) {
  const [routines, setRoutines] = useState<LiveRoutine[]>([]);
  const [targets, setTargets] = useState<{ id: string; name: string; type: string; enabled: boolean }[]>([]);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [afterPrompt, setAfterPrompt] = useState(false);
  const [actualEnd, setActualEnd] = useState('');
  const [mood, setMood] = useState<'SAD' | 'NEUTRAL' | 'GOOD' | 'FIRE' | null>(event.postLiveMood ?? null);
  const [note, setNote] = useState(event.postLiveNote ?? '');
  const [savedNote, setSavedNote] = useState(event.postLiveNote ?? '');

  useEffect(() => { void window.damplanner.cockpitData().then((value: { routines: LiveRoutine[]; targets: { id: string; name: string; type: string; enabled: boolean }[] }) => { setRoutines(value.routines); setTargets(value.targets); }); }, []);
  useEffect(() => {
    setMood(event.postLiveMood ?? null);
    setNote(event.postLiveNote ?? '');
    setSavedNote(event.postLiveNote ?? '');
  }, [event.id, event.postLiveMood, event.postLiveNote]);
  useEffect(() => {
    if (!closing && !afterPrompt) return;
    const key = (keyboard: KeyboardEvent) => {
      if (keyboard.key === 'Escape') { setClosing(false); setAfterPrompt(false); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [closing, afterPrompt]);

  const checks = (event.routineSteps ?? []).filter(step => step.type === 'CHECK');
  const done = checks.filter(step => step.done).length;
  const percent = checks.length ? Math.round(done / checks.length * 100) : 100;
  const view = lifecycleView(event);
  const after = (event.routineSteps ?? []).filter(step => step.phase === 'AFTER' && step.type === 'CHECK' && !step.done);
  const dirty = note !== savedNote || mood !== (event.postLiveMood ?? null);
  const readOnly = view.state === 'FINISHED' || view.state === 'CANCELLED';

  async function transition(state: 'PREPARING' | 'READY' | 'LIVE') {
    if ((state === 'READY' || state === 'LIVE') && done < checks.length) {
      const text = state === 'READY'
        ? `${checks.length - done} étapes sont encore incomplètes. Marquer le live comme prêt quand même ?`
        : `${checks.length - done} étapes de préparation sont encore incomplètes. Passer en live quand même ?`;
      if (!confirm(text)) return;
    }
    setBusy(true); setError('');
    try {
      await window.damplanner.setLifecycle(event.id, state);
      await onReload();
      setFeedback(state === 'PREPARING' ? 'Le live est maintenant en préparation' : state === 'READY' ? '✓ Live marqué comme prêt' : `🔴 Live démarré à ${DateTime.now().setZone(event.timezone).toFormat('HH:mm')}`);
    } catch (reason) {
      setError(`Impossible de changer l’état du live. ${String(reason)}`);
    } finally { setBusy(false); }
  }

  async function execute(targetId: string, label: string) {
    try {
      setError('');
      await window.damplanner.executeAction(targetId);
      setFeedback(`✓ Action lancée : ${label}`);
    } catch (reason) {
      setError(`Impossible d’exécuter ${label}. ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }

  function openClosing() {
    if (after.length) setAfterPrompt(true);
    else { setActualEnd(new Date().toISOString()); setClosing(true); }
  }

  async function saveNotes() {
    setBusy(true); setError('');
    try {
      await window.damplanner.savePostLive(event.id, mood, note);
      setSavedNote(note);
      await onReload();
      setFeedback('✓ Notes enregistrées');
    } catch (reason) {
      setError(`Impossible d’enregistrer les notes. ${String(reason)}`);
    } finally { setBusy(false); }
  }

  async function complete() {
    setBusy(true); setError('');
    try {
      const duration = actualDuration(event.actualStartAt!, actualEnd).label;
      await window.damplanner.completeLive(event.id, actualEnd, mood, note);
      setClosing(false);
      await onComplete(`✓ Live clôturé — ${duration}`);
    } catch (reason) {
      setError(`Impossible de clôturer le live. Les données n’ont pas été modifiées. ${String(reason)}`);
    } finally { setBusy(false); }
  }

  const planned = `${DateTime.fromISO(event.startAtUtc).setZone(event.timezone).toFormat('HH:mm')} → ${DateTime.fromISO(event.endAtUtc).setZone(event.timezone).toFormat('HH:mm')}`;
  const real = event.actualStartAt ? `${DateTime.fromISO(event.actualStartAt).setZone(event.timezone).toFormat('HH:mm')} → ${event.actualEndAt ? DateTime.fromISO(event.actualEndAt).setZone(event.timezone).toFormat('HH:mm') : '…'}` : 'Non démarré';
  const proposedDuration = actualEnd && event.actualStartAt && Date.parse(actualEnd) > Date.parse(event.actualStartAt) ? actualDuration(event.actualStartAt, actualEnd).label : 'Fin invalide';

  return <section className="cockpit">
    <button onClick={onClose}>← Retour</button>
    <small>LIVE COCKPIT</small>
    <h1>{event.title}</h1>
    <div className={`lifecycle-banner lifecycle-${view.state.toLowerCase()}`}><strong>{view.icon} {view.label}</strong><span>{view.time}</span></div>
    {feedback && <p className="success" role="status">{feedback}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="timing-summary"><span><small>PRÉVU</small>{planned}</span><span><small>RÉEL</small>{real}{event.actualStartAt && event.actualEndAt && ` · ${actualDuration(event.actualStartAt, event.actualEndAt).label}`}</span></div>

    {!(event.routineSteps?.length) && !readOnly && <label>Routine <select defaultValue="" onChange={async change => { if (change.target.value) { await window.damplanner.attachRoutine(event.id, change.target.value); await onReload(); } }}><option value="">Choisir…</option>{routines.map(routine => <option key={routine.id} value={routine.id}>{routine.name}</option>)}</select></label>}
    <div className="progress"><span style={{ width: `${percent}%` }} /></div>
    <h2>Préparation : {done}/{checks.length} · {percent}%</h2>
    {(['BEFORE', 'DURING', 'AFTER'] as const).map(phase => <div id={`routine-${phase}`} className="routine-phase" key={phase}>
      <h3>{phase === 'BEFORE' ? 'AVANT' : phase === 'DURING' ? 'PENDANT' : 'APRÈS'}</h3>
      {(event.routineSteps ?? []).filter(step => step.phase === phase).map(step => <div className="routine-step" key={step.id}>
        {step.type === 'CHECK'
          ? <label><input disabled={readOnly} type="checkbox" checked={step.done ?? false} onChange={async change => { await window.damplanner.checkRoutine(event.id, step.id, change.target.checked); await onReload(); }} /> {step.label}</label>
          : step.type === 'TEXT' || step.type === 'SEPARATOR'
            ? <span>{step.label}</span>
            : step.targetId
              ? targets.some(target => target.id === step.targetId)
                ? <button disabled={readOnly} onClick={() => execute(step.targetId!, step.label)}>▶ {step.label}</button>
                : <span className="warning">⚠ Cible introuvable — reconfigurer dans Réglages</span>
              : <span className="warning">⚠ Action non configurée</span>}
      </div>)}
    </div>)}

    <div className="actions lifecycle-actions">
      {view.state === 'PLANNED' && <button className="primary" disabled={busy} onClick={() => transition('PREPARING')}>{busy ? 'Préparation…' : 'Préparer le live'}</button>}
      {view.state === 'PREPARING' && <button className="primary" disabled={busy} onClick={() => transition('READY')}>{busy ? 'Validation…' : '✓ Marquer prêt'}</button>}
      {view.state === 'READY' && <button className="primary live-action" disabled={busy} onClick={() => transition('LIVE')}>{busy ? 'Passage en live…' : '🔴 Je suis en live'}</button>}
      {view.state === 'LIVE' && <button className="primary" disabled={busy} onClick={openClosing}>Terminer le live</button>}
      {!readOnly && <button disabled={busy} onClick={async () => { if (!done || confirm('Réinitialiser la checklist ?')) { await window.damplanner.resetRoutine(event.id); await onReload(); } }}>Réinitialiser la checklist</button>}
    </div>

    {view.state === 'FINISHED' && <section className="post-live-editor">
      <h2>Notes post-live</h2>
      <div className="moods">{([['SAD', '😕'], ['NEUTRAL', '😐'], ['GOOD', '🙂'], ['FIRE', '🔥']] as const).map(([value, emoji]) => <button aria-label={`Humeur ${value}`} className={mood === value ? 'selected' : ''} onClick={() => setMood(value)} key={value}>{emoji}</button>)}</div>
      <textarea maxLength={10000} value={note} onChange={change => setNote(change.target.value)} placeholder="Comment ça s’est passé ?" />
      {dirty && <p className="warning">Modifications non enregistrées</p>}
      <button className="primary" disabled={!dirty || busy} onClick={saveNotes}>{busy ? 'Enregistrement…' : 'Enregistrer les notes'}</button>
    </section>}

    {afterPrompt && <div className="modal" role="dialog" aria-modal="true" aria-labelledby="after-title"><div>
      <h2 id="after-title">Le live est terminé 🔥</h2>
      <p>{after.length} action{after.length > 1 ? 's' : ''} après-live {after.length > 1 ? 'sont encore prévues' : 'est encore prévue'}.</p>
      <div className="actions"><button autoFocus onClick={() => { setAfterPrompt(false); document.getElementById('routine-AFTER')?.scrollIntoView({ behavior: 'smooth' }); }}>Passer aux actions après-live</button><button className="primary" onClick={() => { setAfterPrompt(false); setActualEnd(new Date().toISOString()); setClosing(true); }}>Clôturer maintenant</button></div>
    </div></div>}

    {closing && <div className="modal" role="dialog" aria-modal="true" aria-labelledby="closing-title"><div className="closing-panel">
      <h2 id="closing-title">TERMINER LE LIVE</h2>
      <h3>{event.title}</h3>
      <div className="timing-summary"><span><small>PRÉVU</small>{planned}</span><span><small>RÉEL</small>{DateTime.fromISO(event.actualStartAt!).setZone(event.timezone).toFormat('HH:mm')} → {actualEnd ? DateTime.fromISO(actualEnd).setZone(event.timezone).toFormat('HH:mm') : '…'} · {proposedDuration}</span></div>
      <label>Fin réelle<input type="datetime-local" value={actualEnd ? DateTime.fromISO(actualEnd).setZone(event.timezone).toFormat("yyyy-LL-dd'T'HH:mm") : ''} onChange={change => { const local = DateTime.fromISO(change.target.value, { zone: event.timezone }); if (local.isValid) setActualEnd(local.toUTC().toISO()!); }} /></label>
      <p>Comment ça s’est passé ?</p>
      <div className="moods">{([['SAD', '😕'], ['NEUTRAL', '😐'], ['GOOD', '🙂'], ['FIRE', '🔥']] as const).map(([value, emoji]) => <button aria-label={`Humeur ${value}`} className={mood === value ? 'selected' : ''} onClick={() => setMood(value)} key={value}>{emoji}</button>)}</div>
      <label>Notes<textarea maxLength={10000} autoFocus value={note} onChange={change => setNote(change.target.value)} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions"><button disabled={busy} onClick={() => setClosing(false)}>Annuler</button><button className="primary" disabled={busy || proposedDuration === 'Fin invalide'} onClick={complete}>{busy ? 'Clôture…' : '✓ Valider et clôturer le live'}</button></div>
    </div></div>}
  </section>;
}

const stepLabels: Record<RoutineStep['type'], string> = {
  CHECK: 'Case à cocher',
  OPEN_APP: 'Ouvrir une application',
  OPEN_URL: 'Ouvrir une URL',
  OPEN_FILE: 'Ouvrir un fichier/dossier',
  LOCAL_HTTP: 'HTTP local',
  SEPARATOR: 'Séparateur',
  TEXT: 'Texte',
};

function RoutineEditor({ initial, data, onSaved, onCancel }: { initial?: LiveRoutine; data: CockpitData; onSaved: () => void; onCancel: () => void }) {
  const created = useMemo(() => new Date().toISOString(), []);
  const original = useMemo<LiveRoutine>(() => initial ?? { id: crypto.randomUUID(), name: '', createdAt: created, updatedAt: created, steps: [] }, [initial, created]);
  const [draft, setDraft] = useState<LiveRoutine>(structuredClone(original));
  const [error, setError] = useState('');
  const [targets, setTargets] = useState(data.targets);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);

  function close() { if (!dirty || confirm('Abandonner les modifications ?')) onCancel(); }
  function update(id: string, value: Partial<RoutineStep>) { setDraft(current => ({ ...current, steps: current.steps.map(step => step.id === id ? { ...step, ...value } : step) })); }
  function move(index: number, direction: -1 | 1) {
    setDraft(current => {
      const target = index + direction;
      if (target < 0 || target >= current.steps.length) return current;
      const steps = [...current.steps];
      const [step] = steps.splice(index, 1);
      steps.splice(target, 0, step!);
      return { ...current, steps };
    });
  }
  async function localTarget(step: RoutineStep, selection: 'FILE' | 'DIRECTORY' = 'FILE') {
    try {
      const value = await window.damplanner.createLocalAction(step.label, step.type as 'OPEN_APP' | 'OPEN_FILE', true, selection) as CockpitTarget | null;
      if (value) {
        setTargets(current => [...current.filter(target => target.id !== value.id), value]);
        update(step.id, { targetId: value.id });
      }
    } catch (reason) { setError(String(reason)); }
  }
  async function networkTarget(step: RoutineStep) {
    const url = prompt(step.type === 'LOCAL_HTTP' ? 'URL locale (localhost uniquement)' : 'URL HTTP(S)');
    if (!url) return;
    const id = crypto.randomUUID();
    try {
      const saved = step.type === 'LOCAL_HTTP'
        ? await window.damplanner.saveNetworkAction({ id, name: step.label, type: 'LOCAL_HTTP', url, method: ((prompt('Méthode HTTP : GET ou POST', 'GET') ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET'), enabled: true })
        : await window.damplanner.saveNetworkAction({ id, name: step.label, type: 'OPEN_URL', url, enabled: true });
      const target = saved as CockpitTarget;
      setTargets(current => [...current.filter(value => value.id !== target.id), target]);
      update(step.id, { targetId: target.id });
    } catch (reason) { setError(String(reason)); }
  }
  async function save() {
    setError('');
    try { await window.damplanner.saveRoutine({ ...draft, updatedAt: new Date().toISOString() }); onSaved(); }
    catch (reason) { setError(String(reason)); }
  }

  return <section className="manager-editor">
    <h2>{initial ? 'Modifier' : 'Nouvelle'} routine</h2>
    <label>Nom de la routine<input value={draft.name} onChange={change => setDraft({ ...draft, name: change.target.value })} /></label>
    {(['BEFORE', 'DURING', 'AFTER'] as const).map(phase => <section className="phase-editor" key={phase}>
      <h3>{phase === 'BEFORE' ? 'AVANT' : phase === 'DURING' ? 'PENDANT' : 'APRÈS'}</h3>
      {draft.steps.map((step, index) => step.phase === phase && <article className="step-editor" key={step.id}>
        <label>Type<select value={step.type} onChange={change => update(step.id, { type: change.target.value as RoutineStep['type'], targetId: null })}>{Object.entries(stepLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>{step.type === 'TEXT' ? 'Contenu' : step.type === 'SEPARATOR' ? 'Titre du séparateur' : 'Libellé'}<input value={step.label} onChange={change => update(step.id, { label: change.target.value })} /></label>
        <label>Phase<select value={step.phase} onChange={change => update(step.id, { phase: change.target.value as RoutineStep['phase'] })}><option value="BEFORE">Avant</option><option value="DURING">Pendant</option><option value="AFTER">Après</option></select></label>
        {(step.type.startsWith('OPEN_') || step.type === 'LOCAL_HTTP') && <div className="target-picker">
          <select aria-label="Cible" value={step.targetId ?? ''} onChange={change => update(step.id, { targetId: change.target.value || null })}><option value="">Aucune cible</option>{targets.filter(target => target.type === step.type).map(target => <option value={target.id} key={target.id}>{target.name}</option>)}</select>
          <small>{step.targetId ? `✓ ${targets.find(target => target.id === step.targetId)?.name ?? 'Cible introuvable'}` : 'Cible : Non configurée'}</small>
          {step.type === 'OPEN_APP'
            ? <button type="button" onClick={() => localTarget(step)}>Choisir une application</button>
            : step.type === 'OPEN_FILE'
              ? <><button type="button" onClick={() => localTarget(step, 'FILE')}>Choisir un fichier</button><button type="button" onClick={() => localTarget(step, 'DIRECTORY')}>Choisir un dossier</button></>
              : <button type="button" onClick={() => networkTarget(step)}>Configurer l’URL</button>}
        </div>}
        <div className="step-actions">
          <button type="button" aria-label="Monter" onClick={() => move(index, -1)}>↑</button>
          <button type="button" aria-label="Descendre" onClick={() => move(index, 1)}>↓</button>
          <button type="button" onClick={() => setDraft(current => ({ ...current, steps: current.steps.flatMap(value => value.id === step.id ? [value, { ...value, id: crypto.randomUUID() }] : [value]) }))}>Dupliquer</button>
          <button type="button" onClick={() => setDraft(current => ({ ...current, steps: current.steps.filter(value => value.id !== step.id) }))}>Supprimer</button>
        </div>
      </article>)}
      <button type="button" onClick={() => setDraft(current => ({ ...current, steps: [...current.steps, { id: crypto.randomUUID(), type: 'CHECK', phase, label: 'Nouvelle étape', targetId: null }] }))}>+ Ajouter une étape</button>
    </section>)}
    {dirty && <p className="warning">Modifications non enregistrées</p>}
    {error && <p className="error">{error}</p>}
    <div className="actions"><button onClick={close}>Annuler</button><button className="primary" disabled={!dirty || !draft.name.trim()} onClick={save}>Enregistrer la routine</button></div>
  </section>;
}

function RoutineManager({ data, reload }: { data: CockpitData; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState<LiveRoutine | null | undefined>(undefined);
  const [message, setMessage] = useState('');
  async function duplicate(value: LiveRoutine) {
    const now = new Date().toISOString();
    await window.damplanner.saveRoutine({ ...value, id: crypto.randomUUID(), name: `${value.name} — copie`, steps: value.steps.map(step => ({ ...step, id: crypto.randomUUID() })), createdAt: now, updatedAt: now });
    setMessage('✓ Routine dupliquée'); await reload();
  }
  async function remove(value: LiveRoutine) {
    if (!confirm(`Supprimer la routine « ${value.name} » ? Les modèles associés n’utiliseront plus de routine.`)) return;
    await window.damplanner.deleteRoutine(value.id); setMessage('✓ Routine supprimée'); await reload();
  }
  if (editing !== undefined) return <RoutineEditor initial={editing ?? undefined} data={data} onCancel={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); setMessage('✓ Routine enregistrée'); await reload(); }} />;
  return <section className="settings-manager"><div className="manager-title"><h2>Routines</h2><button className="primary" onClick={() => setEditing(null)}>+ Nouvelle routine</button></div>{message && <p className="success">{message}</p>}{[...data.routines].sort((a, b) => a.name.localeCompare(b.name)).map(routine => <article className="manager-row" key={routine.id}><div><b>{routine.name}</b><small>{routine.steps.length} étape{routine.steps.length > 1 ? 's' : ''}</small></div><div className="actions"><button onClick={() => setEditing(routine)}>Modifier</button><button onClick={() => duplicate(routine)}>Dupliquer</button><button onClick={() => remove(routine)}>Supprimer</button></div></article>)}</section>;
}

function TemplateEditor({ initial, data, onSaved, onCancel }: { initial?: EventTemplate; data: CockpitData; onSaved: () => void; onCancel: () => void }) {
  const original = useMemo<EventTemplate>(() => initial ?? { id: crypto.randomUUID(), name: '', kind: 'LIVE', durationMinutes: 180, description: '', syncGoogle: false, syncTwitch: false, twitchTitle: null, twitchCategoryId: null, twitchCategoryName: null, bufferBeforeMinutes: null, bufferAfterMinutes: null, checklist: [], routineId: null, tags: [], participantIds: [], reminderMinutes: null, color: null }, [initial]);
  const [draft, setDraft] = useState<EventTemplate>(structuredClone(original));
  const [error, setError] = useState('');
  const [categoryQuery, setCategoryQuery] = useState(original.twitchCategoryName ?? '');
  const [categoryResults, setCategoryResults] = useState<Category[]>([]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);

  useEffect(() => {
    if (!draft.syncTwitch || categoryQuery.trim().length < 2 || categoryQuery === draft.twitchCategoryName) return;
    const timer = setTimeout(() => { void window.damplanner.categories(categoryQuery).then((values: Category[]) => setCategoryResults(values)).catch(() => setCategoryResults([])); }, 300);
    return () => clearTimeout(timer);
  }, [categoryQuery, draft.syncTwitch, draft.twitchCategoryName]);

  function close() { if (!dirty || confirm('Abandonner les modifications ?')) onCancel(); }
  async function save() {
    try { await window.damplanner.saveTemplate(draft); onSaved(); }
    catch (reason) { setError(String(reason)); }
  }

  return <section className="manager-editor">
    <h2>{initial ? 'Modifier' : 'Nouveau'} modèle</h2>
    <div className="two"><label>Nom<input value={draft.name} onChange={change => setDraft({ ...draft, name: change.target.value })} /></label><label>Type<select value={draft.kind} onChange={change => setDraft({ ...draft, kind: change.target.value as EventTemplate['kind'], syncTwitch: change.target.value === 'PERSONAL' ? false : draft.syncTwitch })}><option value="LIVE">LIVE</option><option value="PERSONAL">PERSONAL</option></select></label></div>
    <label>Durée (minutes)<input type="number" min="1" max="1440" value={draft.durationMinutes} onChange={change => setDraft({ ...draft, durationMinutes: Number(change.target.value) })} /></label>
    <label>Description<textarea value={draft.description} onChange={change => setDraft({ ...draft, description: change.target.value })} /></label>
    <label><input type="checkbox" checked={draft.syncGoogle} onChange={change => setDraft({ ...draft, syncGoogle: change.target.checked })} /> Publier sur Google par défaut</label>
    {draft.kind === 'LIVE' && <>
      <label><input type="checkbox" checked={draft.syncTwitch} onChange={change => setDraft({ ...draft, syncTwitch: change.target.checked })} /> Publier sur Twitch par défaut</label>
      {draft.syncTwitch && <div className="two">
        <label>Titre Twitch<input value={draft.twitchTitle ?? ''} onChange={change => setDraft({ ...draft, twitchTitle: change.target.value || null })} /><small>{'{date} {day} {game} {participants}'}</small></label>
        <label>Catégorie Twitch<div className="category-template"><input value={categoryQuery} onChange={change => { setCategoryQuery(change.target.value); if (!change.target.value) setDraft({ ...draft, twitchCategoryId: null, twitchCategoryName: null }); }} />{categoryResults.length > 0 && <div className="suggestions template-suggestions">{categoryResults.map(category => <button type="button" key={category.id} onClick={() => { setDraft({ ...draft, twitchCategoryId: category.id, twitchCategoryName: category.name }); setCategoryQuery(category.name); setCategoryResults([]); }}>{category.name}</button>)}</div>}</div></label>
      </div>}
    </>}
    <div className="two"><label>Buffer avant<input type="number" value={draft.bufferBeforeMinutes ?? ''} onChange={change => setDraft({ ...draft, bufferBeforeMinutes: change.target.value ? Number(change.target.value) : null })} /></label><label>Buffer après<input type="number" value={draft.bufferAfterMinutes ?? ''} onChange={change => setDraft({ ...draft, bufferAfterMinutes: change.target.value ? Number(change.target.value) : null })} /></label></div>
    <label>Routine<select value={draft.routineId ?? ''} onChange={change => setDraft({ ...draft, routineId: change.target.value || null })}><option value="">Aucune</option>{draft.routineId && !data.routines.some(routine => routine.id === draft.routineId) && <option value={draft.routineId}>Routine indisponible</option>}{data.routines.map(routine => <option value={routine.id} key={routine.id}>{routine.name}</option>)}</select></label>
    <fieldset><legend>Tags</legend>{data.tags.length ? data.tags.map(tag => <label key={tag.id}><input type="checkbox" checked={draft.tags.includes(tag.name)} onChange={change => setDraft({ ...draft, tags: change.target.checked ? [...draft.tags, tag.name] : draft.tags.filter(value => value !== tag.name) })} />{tag.name}</label>) : <small>Aucun tag configuré.</small>}</fieldset>
    <fieldset><legend>Participants</legend>{data.participants.length ? data.participants.map(person => <label key={person.id}><input type="checkbox" checked={draft.participantIds.includes(person.id)} onChange={change => setDraft({ ...draft, participantIds: change.target.checked ? [...draft.participantIds, person.id] : draft.participantIds.filter(id => id !== person.id) })} />{person.name}</label>) : <small>Aucun participant configuré.</small>}</fieldset>
    <div className="two"><label>Rappel<select value={draft.reminderMinutes ?? ''} onChange={change => setDraft({ ...draft, reminderMinutes: change.target.value ? Number(change.target.value) : null })}><option value="">Aucun</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">1 h</option></select></label><label>Couleur<input type="color" value={draft.color ?? '#7c3aed'} onChange={change => setDraft({ ...draft, color: change.target.value })} /></label></div>
    {dirty && <p className="warning">Modifications non enregistrées</p>}
    {error && <p className="error">{error}</p>}
    <div className="actions"><button onClick={close}>Annuler</button><button className="primary" disabled={!dirty || !draft.name.trim()} onClick={save}>Enregistrer le modèle</button></div>
  </section>;
}

function TemplateManager({ data, templates, reload }: { data: CockpitData; templates: EventTemplate[]; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState<EventTemplate | null | undefined>(undefined);
  const [message, setMessage] = useState('');
  async function duplicate(template: EventTemplate) { await window.damplanner.saveTemplate({ ...template, id: crypto.randomUUID(), name: `${template.name} — copie` }); setMessage('✓ Modèle dupliqué'); await reload(); }
  async function remove(template: EventTemplate) { if (confirm(`Supprimer le modèle « ${template.name} » ?`)) { await window.damplanner.deleteTemplate(template.id); setMessage('✓ Modèle supprimé'); await reload(); } }
  if (editing !== undefined) return <TemplateEditor initial={editing ?? undefined} data={data} onCancel={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); setMessage('✓ Modèle enregistré'); await reload(); }} />;
  return <section className="settings-manager"><div className="manager-title"><h2>Modèles</h2><button className="primary" onClick={() => setEditing(null)}>+ Nouveau modèle</button></div>{message && <p className="success">{message}</p>}{[...templates].sort((a, b) => a.name.localeCompare(b.name)).map(template => <article className="manager-row" key={template.id}><div><b>{template.name}</b><small>{template.kind} · {template.durationMinutes} min · {[template.syncGoogle && 'Google', template.syncTwitch && 'Twitch'].filter(Boolean).join(' + ') || 'Local'}</small><small>{data.routines.find(routine => routine.id === template.routineId)?.name ?? (template.routineId ? 'Routine indisponible' : 'Sans routine')}</small></div><div className="actions"><button onClick={() => setEditing(template)}>Modifier</button><button onClick={() => duplicate(template)}>Dupliquer</button><button onClick={() => remove(template)}>Supprimer</button></div></article>)}</section>;
}

function SettingsView({ value, reload }: { value: Settings; reload: () => Promise<void> }) {
  const [settings, setSettings] = useState(value);
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [device, setDevice] = useState<DeviceState>();
  const [message, setMessage] = useState('');
  const [managerData, setManagerData] = useState<CockpitData>({ routines: [], participants: [], tags: [], targets: [] });
  const [templates, setTemplates] = useState<EventTemplate[]>([]);

  async function loadManagers() {
    setManagerData(await window.damplanner.cockpitData() as CockpitData);
    setTemplates(await window.damplanner.templates() as EventTemplate[]);
  }
  useEffect(() => { void loadManagers(); }, []);

  async function action(work: () => Promise<unknown>, success = 'Opération réussie') {
    try {
      setMessage('Veuillez patienter…');
      await work();
      setMessage(success);
      await reload();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    }
  }
  async function loadCalendars() {
    const values = await window.damplanner.calendars() as GoogleCalendar[];
    setCalendars(values);
  }

  return <section className="panel settings">
    <h1>Réglages</h1>
    <h2>Général</h2>
    <label>Fuseau horaire<input value={settings.timezone} onChange={event => setSettings({ ...settings, timezone: event.target.value })} /></label>
    <label>Actualisation automatique<select value={settings.refreshMinutes} onChange={event => setSettings({ ...settings, refreshMinutes: Number(event.target.value) as Settings['refreshMinutes'] })}><option value="0">Désactivée</option><option value="5">5 min</option><option value="15">15 min</option><option value="30">30 min</option></select></label>

    <h2>Google Calendar</h2>
    <p className="provider-state">{settings.googleConfigured ? settings.googleConnected ? `✓ Connecté${settings.googleAccount ? ` — ${settings.googleAccount}` : ''}` : '○ Configuré, non connecté' : '○ Google non configuré'}</p>
    <div className="actions">
      <button onClick={() => action(() => window.damplanner.importGoogle(), 'Credentials Google importés')}>Importer les credentials Desktop</button>
      <button disabled={!settings.googleConfigured} onClick={() => action(() => window.damplanner.connectGoogle(), 'Google connecté')}>{settings.googleConnected ? 'Reconnecter' : 'Connecter'}</button>
      <button disabled={!settings.googleConnected} onClick={() => action(() => window.damplanner.disconnectGoogle(), 'Google déconnecté')}>Déconnecter</button>
      <button disabled={!settings.googleConnected} onClick={() => action(loadCalendars, 'Agendas chargés')}>Charger les agendas</button>
    </div>
    {calendars.length > 0 && <>
      <label>Agenda par défaut<select value={settings.googleDefaultCalendarId} onChange={event => setSettings({ ...settings, googleDefaultCalendarId: event.target.value })}>{calendars.map(calendar => <option value={calendar.id} key={calendar.id}>{calendar.summary}</option>)}</select></label>
      <fieldset><legend>Agendas de disponibilité et affichage</legend>{calendars.map(calendar => <label key={calendar.id}><input type="checkbox" checked={settings.googleAvailabilityCalendarIds.includes(calendar.id)} onChange={event => setSettings({ ...settings, googleAvailabilityCalendarIds: event.target.checked ? [...settings.googleAvailabilityCalendarIds, calendar.id] : settings.googleAvailabilityCalendarIds.filter(id => id !== calendar.id) })} />{calendar.summary}</label>)}</fieldset>
    </>}

    <h2>Twitch</h2>
    <p className="provider-state">{settings.twitchConfigured ? settings.twitchConnected ? `✓ Connecté${settings.twitchAccount ? ` — ${settings.twitchAccount}` : ''}` : '○ Client configuré, non connecté' : '○ Twitch Client ID manquant'}</p>
    <label>Client ID public<input value={settings.twitchClientId} onChange={event => setSettings({ ...settings, twitchClientId: event.target.value.trim() })} /></label>
    <div className="actions">
      <button onClick={() => action(() => window.damplanner.updateSettings({ twitchClientId: settings.twitchClientId }), 'Client ID enregistré')}>Enregistrer le Client ID</button>
      <button disabled={!settings.twitchClientId} onClick={() => action(async () => setDevice(await window.damplanner.beginTwitch() as DeviceState), 'Code Twitch généré')}>Connecter</button>
      <button disabled={!settings.twitchConnected} onClick={() => action(() => window.damplanner.disconnectTwitch(), 'Twitch déconnecté')}>Déconnecter</button>
    </div>
    {device && <div className="device"><b>Code : {device.userCode}</b><button onClick={() => window.damplanner.openExternal(device.verificationUri)}>Ouvrir Twitch</button><button className="primary" onClick={() => action(() => window.damplanner.completeTwitch(device), 'Twitch connecté')}>J’ai autorisé DamPlanner</button></div>}

    <h2>Disponibilité</h2>
    <label><input type="checkbox" checked={settings.availabilityLocal} onChange={event => setSettings({ ...settings, availabilityLocal: event.target.checked })} />Événements DamPlanner</label>
    <label><input type="checkbox" checked={settings.availabilityGoogle} onChange={event => setSettings({ ...settings, availabilityGoogle: event.target.checked })} />Google Calendar</label>
    <label><input type="checkbox" checked={settings.availabilityTwitch} onChange={event => setSettings({ ...settings, availabilityTwitch: event.target.checked })} />Planning Twitch</label>

    <h2>Temps tampons</h2>
    <div className="two"><label>Avant LIVE (min)<input type="number" min="0" value={settings.liveBufferBefore} onChange={event => setSettings({ ...settings, liveBufferBefore: Number(event.target.value) })} /></label><label>Après LIVE (min)<input type="number" min="0" value={settings.liveBufferAfter} onChange={event => setSettings({ ...settings, liveBufferAfter: Number(event.target.value) })} /></label></div>
    <div className="two"><label>Avant perso (min)<input type="number" min="0" value={settings.personalBufferBefore} onChange={event => setSettings({ ...settings, personalBufferBefore: Number(event.target.value) })} /></label><label>Après perso (min)<input type="number" min="0" value={settings.personalBufferAfter} onChange={event => setSettings({ ...settings, personalBufferAfter: Number(event.target.value) })} /></label></div>

    <RoutineManager data={managerData} reload={loadManagers} />
    <TemplateManager data={managerData} templates={templates} reload={loadManagers} />

    <h2>Windows</h2>
    <label><input type="checkbox" checked={settings.notificationsEnabled} onChange={event => setSettings({ ...settings, notificationsEnabled: event.target.checked })} />Notifications activées</label>
    <label>Rappel LIVE (min)<input type="number" min="0" value={settings.liveReminderMinutes} onChange={event => setSettings({ ...settings, liveReminderMinutes: Number(event.target.value) })} /></label>
    <label>Rappel personnel (min)<input type="number" min="0" value={settings.personalReminderMinutes} onChange={event => setSettings({ ...settings, personalReminderMinutes: Number(event.target.value) })} /></label>
    <label><input type="checkbox" checked={settings.closeToTray} onChange={event => setSettings({ ...settings, closeToTray: event.target.checked })} />Fermer dans la zone de notification</label>
    <label><input type="checkbox" checked={settings.launchAtStartup} onChange={event => setSettings({ ...settings, launchAtStartup: event.target.checked })} />Lancer DamPlanner au démarrage de Windows</label>

    <h2>État des connexions</h2>
    <div className="actions"><button onClick={() => action(async () => { const result = await window.damplanner.testConnections() as { google: { connected: boolean; calendars: number }; twitch: { connected: boolean; schedule: boolean } }; setMessage(`Google : ${result.google.connected ? 'connecté' : 'non connecté'} · ${result.google.calendars} agenda(s) | Twitch : ${result.twitch.connected && result.twitch.schedule ? 'opérationnel' : 'à vérifier'}`); }, '')}>Tester les connexions</button></div>

    <button className="primary" onClick={() => action(() => window.damplanner.updateSettings(settings as unknown as Record<string, unknown>), 'Réglages enregistrés')}>Enregistrer les réglages</button>
    {message && <p>{message}</p>}
  </section>;
}

function App() {
  const [settings, setSettings] = useState(defaults);
  const [hub, setHub] = useState<Hub>({ items: [], rows: [], warnings: [], fetchedAt: Date.now(), fromCache: false });
  const [view, setView] = useState<'today' | 'planning' | 'agenda' | 'form' | 'settings' | 'cockpit'>('today');
  const [editing, setEditing] = useState<PlannerEvent>();
  const [prefill, setPrefill] = useState<Prefill>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('Tous');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  async function load(refresh = false) {
    try {
      const value = await window.damplanner.settings() as Settings;
      const nextSettings = { ...defaults, ...value };
      setSettings(nextSettings);
      const now = DateTime.now().setZone(nextSettings.timezone);
      const data = await window.damplanner.hub(now.minus({ days: 30 }).toUTC().toISO()!, now.plus({ days: 90 }).toUTC().toISO()!, refresh) as Hub;
      setHub(data);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setLoaded(true); }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!settings.refreshMinutes) return;
    const timer = setInterval(() => void load(true), settings.refreshMinutes * 60_000);
    return () => clearInterval(timer);
  }, [settings.refreshMinutes]);

  const shown = useMemo(() => hub.items.filter(item => {
    const haystack = `${item.title} ${item.description ?? ''} ${item.calendarName ?? ''} ${item.metadata?.categoryName ?? ''}`.toLowerCase();
    const matchesSearch = haystack.includes(query.toLowerCase());
    const matchesFilter = filter === 'Tous'
      || filter === 'LIVE' && item.kind === 'LIVE'
      || filter === 'Personnel' && item.kind === 'PERSONAL'
      || filter === 'Brouillons' && item.draft
      || filter === 'Préparation' && item.lifecycleState === 'PREPARING'
      || filter === 'Prêts' && item.lifecycleState === 'READY'
      || filter === 'En live' && item.lifecycleState === 'LIVE'
      || filter === 'Terminés' && item.lifecycleState === 'FINISHED'
      || filter === 'DamPlanner' && item.source === 'DAMPLANNER'
      || filter === 'Google' && item.source === 'GOOGLE'
      || filter === 'Twitch' && item.source === 'TWITCH'
      || filter === 'Erreurs' && [item.google?.status, item.twitch?.status].some(status => status === 'ERROR' || status === 'REAUTH_REQUIRED')
      || filter === 'Synchronisés' && [item.google?.status, item.twitch?.status].some(status => status === 'SYNCED');
    return matchesSearch && matchesFilter;
  }), [hub.items, query, filter]);

  function openEdit(id: string) {
    setEditing(hub.rows.find(row => row.event.id === id)?.event);
    setPrefill(undefined);
    setView('form');
  }

  async function openPrepare(id: string) {
    try {
      let current = (await window.damplanner.list() as Row[]).find(row => row.event.id === id)?.event;
      if (!current) throw new Error('Événement introuvable');
      if ((current.lifecycleState ?? 'PLANNED') === 'PLANNED') current = await window.damplanner.setLifecycle(id, 'PREPARING') as PlannerEvent;
      setEditing(current);
      setView('cockpit');
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function refreshCockpit() {
    await load(true);
    if (!editing) return;
    const rows = await window.damplanner.list() as Row[];
    setEditing(rows.find(row => row.event.id === editing.id)?.event);
  }

  async function move(item: CalendarItem, startAtUtc: string, endAtUtc: string) {
    const row = hub.rows.find(value => value.event.id === item.localEventId);
    if (!row) return;
    const input: Record<string, unknown> = { ...row.event, startAtUtc, endAtUtc };
    for (const key of ['id', 'createdAt', 'updatedAt', 'deletedAt', 'conflictOverrideHash', 'conflictOverrideAt']) delete input[key];
    const preview = await window.damplanner.preview(input as EventInput, row.event.id) as Preview;
    if (preview.availability.status !== 'AVAILABLE' && !confirm('Chevauchement détecté. Déplacer quand même ?')) return;
    await window.damplanner.save(input as EventInput, row.event.id, preview.availability.status === 'AVAILABLE' ? undefined : preview.availability.hash);
    await load(true);
  }

  if (loaded && !settings.onboardingDone) return <div className="onboarding"><div><b>◆ DamPlanner</b><h1>Votre planning, en toute simplicité</h1><p>Centralisez DamPlanner, Google Calendar et Twitch.</p><label>Fuseau horaire<input value={settings.timezone} onChange={event => setSettings({ ...settings, timezone: event.target.value })} /></label><div className="actions"><button onClick={async () => { await window.damplanner.updateSettings({ timezone: settings.timezone, onboardingDone: true }); await load(); setView('today'); }}>Configurer plus tard</button><button className="primary" onClick={async () => { await window.damplanner.updateSettings({ timezone: settings.timezone, onboardingDone: true }); await load(); setView('settings'); }}>Configurer Google et Twitch</button></div></div></div>;

  return <>
    <header><b>◆ DamPlanner</b><nav><button className={view === 'today' ? 'active' : ''} onClick={() => setView('today')}>Aujourd’hui</button><button className={view === 'planning' ? 'active' : ''} onClick={() => setView('planning')}>Planning</button><button className={view === 'agenda' ? 'active' : ''} onClick={() => setView('agenda')}>Agenda</button><button className="primary" onClick={() => { setEditing(undefined); setPrefill(undefined); setView('form'); }}>+ Nouvel événement</button><button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>Réglages</button></nav></header>
    <main>
      {toast && <p className="success global-toast" role="status">{toast}</p>}
      {error && <p className="error">{error}</p>}
      {view === 'form' && <EventForm editing={editing} prefill={prefill} settings={settings} onCancel={() => setView('planning')} onDone={async () => { await load(true); setView('planning'); }} />}
      {view === 'cockpit' && editing && <Cockpit event={editing} onClose={() => setView('today')} onComplete={async message => { await load(true); setToast(message); setView('planning'); }} onReload={refreshCockpit} />}
      {view === 'settings' && <SettingsView value={settings} reload={() => load()} />}
      {view === 'today' && <Today items={shown} zone={settings.timezone} onEdit={openEdit} onReload={() => void load(true)} onPrepare={openPrepare} />}
      {view === 'agenda' && <Agenda items={shown} zone={settings.timezone} onCreate={value => { setPrefill(value); setEditing(undefined); setView('form'); }} onEdit={openEdit} onMove={move} onPrepare={openPrepare} />}
      {view === 'planning' && <>
        <div className="hero"><div><small>PLANNING UNIFIÉ</small><h1>Votre agenda</h1><p>{shown.length} élément(s) · Dernière actualisation : {DateTime.fromMillis(hub.fetchedAt).toFormat('HH:mm')}{hub.fromCache ? ' · données en cache' : ''}</p></div><button onClick={() => load(true)}>Actualiser</button></div>
        {hub.warnings.map(warning => <p className="warning" key={warning}>⚠ {warning}</p>)}
        <div className="search"><input aria-label="Rechercher" placeholder="Rechercher…" value={query} onChange={event => setQuery(event.target.value)} /></div>
        <div className="filters">{['Tous', 'LIVE', 'Personnel', 'Brouillons', 'Préparation', 'Prêts', 'En live', 'Terminés', 'DamPlanner', 'Google', 'Twitch', 'Synchronisés', 'Erreurs'].map(value => <button className={filter === value ? 'active' : ''} key={value} onClick={() => setFilter(value)}>{value}</button>)}</div>
        {shown.length === 0 && <section className="empty"><h2>Rien à afficher</h2><p>Modifiez les filtres ou créez un événement.</p></section>}
        {shown.map(item => <ItemCard key={item.id} item={item} onReload={() => void load(true)} onEdit={openEdit} onPrepare={openPrepare} />)}
      </>}
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
