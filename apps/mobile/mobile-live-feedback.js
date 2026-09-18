import { CompanionMode, createCompanionStore } from './companion-store.js';
import { DEFAULT_FILTERS, filterPlanning, filterPlanningTemporal, paginatePlanning, TEMPORAL_FILTERS } from './planning-model.js';
import { createNativeProviderAdapter, createStandaloneProviderSync } from './provider-sync.js';
import { credentialStorage, settingsStorage } from './storage.js';
import { createTransport } from './transport.js';

const $ = id => document.getElementById(id);
const companion = createCompanionStore();
let credential = '';
let hotState = null;
let editingPlanningId = null;
let companionSyncFlight = null;
let planningEnhanceQueued = false;
let planningObserver = null;
const server = settingsStorage.getServer();
const transport = createTransport(() => server, () => credential);
const providerSync = createStandaloneProviderSync({ store: companion, adapter: createNativeProviderAdapter() });

const notify = value => { if ($('message')) $('message').textContent = String(value || ''); };
const text = (tag, value, className) => {
  const node = document.createElement(tag);
  node.textContent = String(value ?? '');
  if (className) node.className = className;
  return node;
};
const onlinePc = () => $('pc')?.textContent === 'Connecté';
const mode = () => onlinePc() ? CompanionMode.ONLINE_PC : navigator.onLine ? CompanionMode.ONLINE_STANDALONE : CompanionMode.OFFLINE;

async function ensureCredential() {
  if (!credential) credential = await credentialStorage.get() || '';
  if (!credential) throw new Error('Télécommande non appairée.');
  return credential;
}

function applyCriticalState(next) {
  if (!next) return;
  hotState = next;
  if ($('live')) {
    $('live').textContent = next.obs?.streaming ? 'Live' : 'Hors ligne';
    $('live').className = next.obs?.streaming ? 'ok' : '';
  }
  if ($('stream')) {
    $('stream').textContent = next.obs?.streaming ? 'ARRÊTER LE LIVE' : 'DÉMARRER LE LIVE';
    $('stream').disabled = !next.obs?.connected;
  }
  renderChecklist();
  queuePlanningEnhance();
}

async function refreshRemoteState() {
  if (!onlinePc()) return null;
  await ensureCredential();
  const next = await transport.state();
  applyCriticalState(next);
  return next;
}

async function syncCompanionNow() {
  if (companionSyncFlight) return companionSyncFlight;
  if (!onlinePc()) {
    renderNotes();
    renderChecklist();
    window.dispatchEvent(new CustomEvent('companion-refreshed'));
    return null;
  }
  companionSyncFlight = (async () => {
    await ensureCredential();
    const deviceId = localStorage.getItem('streamdashboard.deviceId') || '';
    if (!deviceId) throw new Error('Identité de télécommande introuvable.');
    const cache = companion.snapshot();
    const response = await transport.syncCompanion({
      schemaVersion: cache.schemaVersion,
      deviceId,
      lastKnownServerRevision: cache.serverRevision || 0,
      operations: cache.pending,
    });
    companion.applySyncResponse(response);
    renderNotes();
    window.dispatchEvent(new CustomEvent('companion-refreshed'));
    return response;
  })();
  try { return await companionSyncFlight; }
  finally { companionSyncFlight = null; }
}

function renderNotes() {
  const root = $('notes');
  if (!root) return;
  root.replaceChildren();
  const notes = companion.snapshot().notes;
  for (const item of notes) {
    const row = document.createElement('div');
    row.className = 'companion-row mobile-note-row';
    const label = text('button', item.text || '', 'note-open');
    label.type = 'button';
    label.onclick = async () => {
      const value = prompt('Modifier la note', item.text || '');
      if (value === null || !value.trim() || value.trim() === item.text) return;
      companion.upsertCollection('notes', { ...item, text: value.trim() });
      renderNotes();
      try { await syncCompanionNow(); notify('Note modifiée.'); } catch (error) { notify(error.message); }
    };
    const menu = document.createElement('details'); menu.className = 'row-overflow'; const summary = text('summary', '⋮'); summary.setAttribute('aria-label', 'Actions de la note');
    const remove = text('button', 'Supprimer');
    remove.type = 'button';
    remove.className = 'secondary danger-button';
    remove.onclick = async () => {
      if (!confirm('Supprimer cette note ?')) return;
      companion.removeCollection('notes', item.id);
      renderNotes();
      try { await syncCompanionNow(); notify('Note supprimée.'); } catch (error) { notify(error.message); }
    };
    menu.append(summary, remove);
    row.append(label, menu);
    root.append(row);
  }
  if (!notes.length) root.append(text('p', 'Aucune note pour le moment.', 'muted'));
}

function checklistValues() {
  if (onlinePc() && Array.isArray(hotState?.checklist)) return hotState.checklist;
  return companion.snapshot().checklist;
}

function renderChecklist() {
  const root = $('checklist');
  if (!root) return;
  root.replaceChildren();
  const values = checklistValues();
  for (const item of values) {
    const row = document.createElement('div');
    row.className = 'checklist-row';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `checklist-toggle${item.done ? ' done' : ''}`;
    toggle.textContent = `${item.done ? '✓' : '○'} ${item.label}`;
    toggle.onclick = async () => {
      toggle.disabled = true;
      try {
        if (onlinePc()) {
          await ensureCredential();
          const result = await transport.command({ type: 'checklist.toggle', id: item.id });
          applyCriticalState(result.state);
          await syncCompanionNow();
        } else {
          companion.upsertCollection('checklist', { ...item, done: !item.done });
          renderChecklist();
        }
      } catch (error) { notify(error.message); }
      finally { toggle.disabled = false; }
    };
    const menu = document.createElement('details'); menu.className = 'row-overflow'; const summary = text('summary', '⋮'); summary.setAttribute('aria-label', `Actions pour ${item.label}`);
    const remove = text('button', 'Supprimer');
    remove.type = 'button';
    remove.className = 'secondary checklist-remove';
    remove.title = 'Supprimer';
    remove.onclick = async () => {
      if (!confirm(`Supprimer « ${item.label} » de la checklist ?`)) return;
      try {
        if (onlinePc()) await syncCompanionNow();
        const removed = companion.removeCollection('checklist', item.id);
        if (!removed.deleted) throw new Error('Cet élément doit d’abord être synchronisé avant suppression.');
        renderChecklist();
        await syncCompanionNow();
        if (onlinePc()) await refreshRemoteState();
      } catch (error) { notify(error.message); }
    };
    menu.append(summary, remove); row.append(toggle, menu);
    root.append(row);
  }
  if (!values.length) root.append(text('p', 'Checklist vide. Ajoute le premier point à vérifier.', 'muted'));
  const completed = values.filter(item => item.done).length; const copy = $('check-progress-copy'); const bar = $('mobile-check-progress'); if (copy) copy.textContent = `${completed} / ${values.length}`; if (bar) bar.style.width = `${values.length ? completed / values.length * 100 : 0}%`;

  // Reset is intentionally local-desktop only in remote-policy. Do not render a dead control.
}

async function addNote() {
  const input = $('note-text');
  const value = input?.value.trim();
  if (!value) return;
  companion.upsertCollection('notes', { text: value });
  input.value = '';
  renderNotes();
  $('note-dialog')?.close();
  try { await syncCompanionNow(); notify(onlinePc() ? 'Note enregistrée et synchronisée.' : 'Note enregistrée · À synchroniser.'); }
  catch (error) { notify(error.message); }
}

async function addChecklistItem() {
  const input = $('check-label');
  const value = input?.value.trim();
  if (!value) return;
  companion.upsertCollection('checklist', { label: value, done: false });
  input.value = '';
  renderChecklist();
  try {
    await syncCompanionNow();
    if (onlinePc()) await refreshRemoteState();
    notify(onlinePc() ? 'Élément ajouté à la checklist.' : 'Élément enregistré · À synchroniser.');
  } catch (error) { notify(error.message); }
}

async function prepareFromPhone(button) {
  button.disabled = true;
  try {
    await ensureCredential();
    const result = await transport.command({ type: 'session.prepare' });
    applyCriticalState(result.state);
    document.querySelector('[data-open-tab="prepare"]')?.click();
    const preflight = result.state.preflight;
    if (preflight?.status === 'action-required' || preflight?.status === 'error') notify(preflight.error || 'Préparation à compléter.');
    else notify('Préparation lancée · vérifie la checklist avant le live.');
    await syncCompanionNow();
  } catch (error) { notify(error.message); }
  finally { button.disabled = false; }
}

function localDate(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function localTime(value) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function clearPlanningEdit() {
  editingPlanningId = null;
  $('slot-form')?.removeAttribute('data-editing-id');
  const heading = $('slot-dialog')?.querySelector('h2');
  if (heading) heading.textContent = 'Nouveau créneau';
}

function openPlanningEdit(item) {
  if (item.editable === false) { notify('Cet événement est en lecture seule.'); return; }
  editingPlanningId = item.id;
  const form = $('slot-form');
  form.dataset.editingId = item.id;
  form.elements.namedItem('title').value = item.title || '';
  form.elements.namedItem('date').value = localDate(item.startAtUtc);
  form.elements.namedItem('start').value = localTime(item.startAtUtc);
  form.elements.namedItem('end').value = localTime(item.endAtUtc);
  form.elements.namedItem('category').value = item.category || 'live';
  form.elements.namedItem('description').value = item.description || '';
  form.elements.namedItem('twitch').checked = item.desiredPublication?.twitch === true;
  form.elements.namedItem('google').checked = item.desiredPublication?.google === true;
  $('slot-twitch-category').value = item.twitchCategoryName || '';
  $('slot-twitch-game-id').value = item.twitchCategoryId || '';
  $('slot-twitch-results').replaceChildren();
  const heading = $('slot-dialog').querySelector('h2');
  if (heading) heading.textContent = 'Modifier le créneau';
  $('slot-dialog').showModal();
}

function planningPayload(formElement) {
  const form = new FormData(formElement);
  const date = String(form.get('date') || '');
  const startAtUtc = new Date(`${date}T${form.get('start')}`).toISOString();
  const endAtUtc = new Date(`${date}T${form.get('end')}`).toISOString();
  if (form.get('twitch') === 'on' && !$('slot-twitch-game-id').value) throw new Error('Sélectionnez une catégorie Twitch officielle.');
  return {
    title: String(form.get('title') || '').trim(),
    startAtUtc,
    endAtUtc,
    category: form.get('category'),
    description: form.get('description') || '',
    desiredPublication: { local: true, twitch: form.get('twitch') === 'on', google: form.get('google') === 'on' },
    twitchCategoryId: form.get('twitch') === 'on' ? $('slot-twitch-game-id').value : undefined,
    twitchCategoryName: form.get('twitch') === 'on' ? $('slot-twitch-category').value : undefined,
  };
}

async function submitPlanningEdit(event) {
  if (!editingPlanningId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const id = editingPlanningId;
  const formElement = event.currentTarget;
  try {
    const payload = planningPayload(formElement);
    if (onlinePc()) {
      await ensureCredential();
      const next = await transport.updatePlanning(id, payload);
      applyCriticalState(next);
      notify('Créneau modifié.');
    } else {
      const current = companion.snapshot().planning.find(item => item.id === id);
      if (!current) throw new Error('Créneau introuvable dans le cache mobile.');
      const result = companion.updateEvent(id, payload, current.revision);
      if (result.conflict) throw new Error('Ce créneau a changé sur un autre appareil.');
      if (mode() === CompanionMode.ONLINE_STANDALONE) await providerSync.apply(mode(), result.item, 'update');
      notify('Créneau modifié · À synchroniser.');
    }
    $('slot-dialog').close();
    formElement.reset();
    clearPlanningEdit();
    if (onlinePc()) await refreshRemoteState();
    else queuePlanningEnhance();
  } catch (error) { notify(error.message); }
}

async function deletePlanningItem(item) {
  if (item.editable === false) { notify('Cet événement est en lecture seule.'); return; }
  if (!confirm(`Supprimer « ${item.title} » ?`)) return;
  try {
    if (onlinePc()) {
      await ensureCredential();
      const next = await transport.deletePlanning(item.id);
      applyCriticalState(next);
      notify('Créneau supprimé.');
      await refreshRemoteState();
    } else {
      const current = companion.snapshot().planning.find(value => value.id === item.id) || item;
      const result = companion.deleteEvent(item.id, current.revision);
      if (result.conflict) throw new Error('Ce créneau a changé sur un autre appareil.');
      if (mode() === CompanionMode.ONLINE_STANDALONE) await providerSync.apply(mode(), current, 'delete');
      notify('Créneau supprimé · À synchroniser.');
      queuePlanningEnhance();
    }
  } catch (error) { notify(error.message); }
}

function planningItemsForVisibleRows() {
  const source = onlinePc() ? hotState?.planning || [] : companion.snapshot().planning;
  let filters = { ...DEFAULT_FILTERS };
  try { filters = { ...filters, ...JSON.parse(localStorage.getItem('streamdashboard.planningFilters') || '{}') }; } catch { /* ignore */ }
  const temporal = localStorage.getItem('streamdashboard.planningTemporal') || TEMPORAL_FILTERS.UPCOMING;
  const filtered = filterPlanning(source, filters);
  const temporalItems = filterPlanningTemporal(filtered, temporal, new Date());
  const label = $('planning')?.querySelector('.planning-pagination span')?.textContent || '';
  const page = Number(label.match(/Page\s+(\d+)/)?.[1] || 1);
  return paginatePlanning(temporalItems, page, 8).items;
}

function enhancePlanningRows() {
  planningEnhanceQueued = false;
  const root = $('planning');
  if (!root) return;
  planningObserver?.disconnect();
  try {
    const rows = [...root.children].filter(node => node.classList?.contains('planning-row'));
    const items = planningItemsForVisibleRows();
    rows.forEach((row, index) => {
      const item = items[index];
      if (!item) return;
      for (const button of [...row.querySelectorAll('button')]) {
        if (['Modifier', 'Supprimer'].includes(button.textContent?.trim())) button.remove();
      }
      row.querySelector('.mobile-event-actions')?.remove();
      const actions = document.createElement('div');
      actions.className = 'mobile-event-actions';
      const edit = text('button', 'MODIFIER');
      edit.type = 'button';
      edit.disabled = item.editable === false;
      edit.onclick = () => openPlanningEdit(item);
      const remove = text('button', 'SUPPRIMER');
      remove.type = 'button';
      remove.className = 'secondary danger-button';
      remove.disabled = item.editable === false;
      remove.onclick = () => void deletePlanningItem(item);
      actions.append(edit, remove);
      row.append(actions);
    });
  } finally {
    planningObserver?.observe(root, { childList: true, subtree: true });
  }
}

function queuePlanningEnhance() {
  if (planningEnhanceQueued) return;
  planningEnhanceQueued = true;
  queueMicrotask(enhancePlanningRows);
}

async function refreshAll() {
  try {
    if (onlinePc()) {
      await ensureCredential();
      await syncCompanionNow();
      await refreshRemoteState();
    } else {
      renderNotes();
      renderChecklist();
      queuePlanningEnhance();
    }
  } catch (error) { notify(error.message); }
}

// Capture the hot-path actions before the legacy mobile handlers. Commands are HTTP;
// they must not depend on an incidental WebSocket state.
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.command === 'session.prepare') {
    event.preventDefault(); event.stopImmediatePropagation();
    void prepareFromPhone(button);
    return;
  }
  if (button.id === 'add-note') {
    event.preventDefault(); event.stopImmediatePropagation();
    void addNote();
    return;
  }
  if (button.id === 'add-check') {
    event.preventDefault(); event.stopImmediatePropagation();
    void addChecklistItem();
    return;
  }
  if (button.id === 'add-slot') clearPlanningEdit();
  if (button.id === 'close-slot') clearPlanningEdit();
}, true);

$('slot-form')?.addEventListener('submit', event => void submitPlanningEdit(event), true);
$('slot-dialog')?.addEventListener('cancel', clearPlanningEdit);

planningObserver = new MutationObserver(queuePlanningEnhance);
if ($('planning')) planningObserver.observe($('planning'), { childList: true, subtree: true });

const connectionObserver = new MutationObserver(() => void refreshAll());
if ($('pc')) connectionObserver.observe($('pc'), { childList: true, characterData: true, subtree: true });

window.addEventListener('companion-mutated', () => void syncCompanionNow().then(() => refreshRemoteState()).catch(error => notify(error.message)));
window.addEventListener('online', () => void refreshAll());
window.addEventListener('offline', () => { renderNotes(); renderChecklist(); queuePlanningEnhance(); });

document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshAll(); });

void (async () => {
  credential = await credentialStorage.get() || '';
  renderNotes();
  renderChecklist();
  queuePlanningEnhance();
  setTimeout(() => void refreshAll(), 250);
  setTimeout(() => void refreshAll(), 1_000);
})();
