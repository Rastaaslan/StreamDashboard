import { CompanionMode } from '../companion-store.js';
import { getMobileContext } from '../mobile-context.js';

const $ = id => document.getElementById(id);
const { companion, transport, ensureCredential, executeCommand, syncCompanion, getMode, getState, applyState, note } = getMobileContext();

const text = (tag, value, className) => {
  const node = document.createElement(tag);
  node.textContent = String(value ?? '');
  if (className) node.className = className;
  return node;
};
const onlinePc = () => getMode() === CompanionMode.ONLINE_PC;

async function refreshRemoteState() {
  if (!onlinePc()) return null;
  await ensureCredential();
  const next = await transport.state();
  applyState(next);
  renderChecklist();
  return next;
}

async function syncCompanionNow() {
  if (!onlinePc()) {
    renderNotes();
    renderChecklist();
    window.dispatchEvent(new CustomEvent('companion-refreshed'));
    return null;
  }
  await ensureCredential();
  const response = await syncCompanion();
  renderNotes();
  renderChecklist();
  window.dispatchEvent(new CustomEvent('companion-refreshed'));
  return response;
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
      try { await syncCompanionNow(); note('Note modifiée.'); } catch (error) { note(error.message); }
    };
    const menu = document.createElement('details');
    menu.className = 'row-overflow';
    const summary = text('summary', '⋮');
    summary.setAttribute('aria-label', 'Actions de la note');
    const remove = text('button', 'Supprimer');
    remove.type = 'button';
    remove.className = 'secondary danger-button';
    remove.onclick = async () => {
      if (!confirm('Supprimer cette note ?')) return;
      companion.removeCollection('notes', item.id);
      renderNotes();
      try { await syncCompanionNow(); note('Note supprimée.'); } catch (error) { note(error.message); }
    };
    menu.append(summary, remove);
    row.append(label, menu);
    root.append(row);
  }
  if (!notes.length) root.append(text('p', 'Aucune note pour le moment.', 'muted'));
}

function checklistValues() {
  const state = getState();
  if (onlinePc() && Array.isArray(state?.checklist)) return state.checklist;
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
          const confirmed = await executeCommand({ type: 'checklist.toggle', id: item.id });
          if (!confirmed) throw new Error('Commande checklist non confirmée.');
          await refreshRemoteState();
          await syncCompanionNow();
        } else {
          companion.upsertCollection('checklist', { ...item, done: !item.done });
          renderChecklist();
        }
      } catch (error) { note(error.message); }
      finally { toggle.disabled = false; }
    };
    const menu = document.createElement('details');
    menu.className = 'row-overflow';
    const summary = text('summary', '⋮');
    summary.setAttribute('aria-label', `Actions pour ${item.label}`);
    const remove = text('button', 'Supprimer');
    remove.type = 'button';
    remove.className = 'secondary checklist-remove';
    remove.onclick = async () => {
      if (!confirm(`Supprimer « ${item.label} » de la checklist ?`)) return;
      try {
        const removed = companion.removeCollection('checklist', item.id);
        if (!removed.deleted) throw new Error('Cet élément doit d’abord être synchronisé avant suppression.');
        renderChecklist();
        await syncCompanionNow();
        if (onlinePc()) await refreshRemoteState();
      } catch (error) { note(error.message); }
    };
    menu.append(summary, remove);
    row.append(toggle, menu);
    root.append(row);
  }
  if (!values.length) root.append(text('p', 'Checklist vide. Ajoute le premier point à vérifier.', 'muted'));
  const completed = values.filter(item => item.done).length;
  if ($('check-progress-copy')) $('check-progress-copy').textContent = `${completed} / ${values.length}`;
  if ($('mobile-check-progress')) $('mobile-check-progress').style.width = `${values.length ? completed / values.length * 100 : 0}%`;
}

async function addNote() {
  const input = $('note-text');
  const value = input?.value.trim();
  if (!value) return;
  companion.upsertCollection('notes', { text: value });
  input.value = '';
  renderNotes();
  $('note-dialog')?.close();
  try {
    await syncCompanionNow();
    note(onlinePc() ? 'Note enregistrée et synchronisée.' : 'Note enregistrée · À synchroniser.');
  } catch (error) { note(error.message); }
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
    note(onlinePc() ? 'Élément ajouté à la checklist.' : 'Élément enregistré · À synchroniser.');
  } catch (error) { note(error.message); }
}

async function prepareFromPhone(button) {
  button.disabled = true;
  try {
    await ensureCredential();
    const confirmed = await executeCommand({ type: 'session.prepare' });
    if (!confirmed) throw new Error('Préparation non confirmée par le PC.');
    const next = await refreshRemoteState();
    document.querySelector('[data-open-tab="prepare"]')?.click();
    const preflight = next?.preflight;
    if (preflight?.status === 'action-required' || preflight?.status === 'error') note(preflight.error || 'Préparation à compléter.');
    else note('Préparation lancée · vérifie la checklist avant le live.');
    await syncCompanionNow();
  } catch (error) { note(error.message); }
  finally { button.disabled = false; }
}

for (const button of document.querySelectorAll('button[data-command="session.prepare"]')) {
  button.onclick = event => {
    event.stopPropagation();
    void prepareFromPhone(button);
  };
}
$('add-note').onclick = () => void addNote();
$('add-check').onclick = () => void addChecklistItem();

window.addEventListener('companion-mutated', event => {
  if (!['notes', 'checklist'].includes(event.detail?.kind)) return;
  void syncCompanionNow().then(() => refreshRemoteState()).catch(error => note(error.message));
});
window.addEventListener('online', () => { if (onlinePc()) void refreshRemoteState(); });
window.addEventListener('offline', () => { renderNotes(); renderChecklist(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && onlinePc()) void refreshRemoteState(); });

renderNotes();
renderChecklist();
setTimeout(() => { if (onlinePc()) void syncCompanionNow().then(refreshRemoteState).catch(error => note(error.message)); }, 250);
