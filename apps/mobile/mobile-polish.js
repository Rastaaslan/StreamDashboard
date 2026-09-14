import { createCompanionStore } from './companion-store.js';
import { credentialStorage, settingsStorage } from './storage.js';
import { createTransport } from './transport.js';
import { expandRecurringItems } from './shared/recurrence.js';

const $ = id => document.getElementById(id);
const companion = createCompanionStore();
const note = value => { const target = $('message'); if (target) target.textContent = String(value || ''); };
const DAY_MS = 86_400_000;

function planningForm() { return $('slot-form'); }

function localDate(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
function localTime(value) {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

function ensureScheduleDefaults() {
  const form = planningForm();
  if (!form) return;
  const date = form.elements.namedItem('date');
  const start = form.elements.namedItem('start');
  const end = form.elements.namedItem('end');
  if (date?.value && start?.value && end?.value) return;
  const rounded = new Date();
  rounded.setSeconds(0, 0);
  rounded.setMinutes(rounded.getMinutes() < 30 ? 30 : 60);
  const finish = new Date(rounded.getTime() + 2 * 60 * 60 * 1000);
  if (date && !date.value) date.value = localDate(rounded);
  if (start && !start.value) start.value = localTime(rounded);
  if (end && !end.value) end.value = localTime(finish);
}

function templateWouldOverwriteUserInput(form) {
  return Boolean(
    form.elements.namedItem('title')?.value?.trim()
    || form.elements.namedItem('description')?.value?.trim()
    || $('slot-twitch-category')?.value?.trim()
    || form.elements.namedItem('twitch')?.checked
    || form.elements.namedItem('google')?.checked
  );
}

function applyTemplate(template, { confirmOverwrite = false } = {}) {
  const form = planningForm();
  if (!form || !template) return false;
  if (confirmOverwrite && templateWouldOverwriteUserInput(form)
    && !confirm('Appliquer ce template et remplacer les champs déjà préremplis ? La date, les horaires et la périodicité resteront inchangés.')) return false;

  form.elements.namedItem('title').value = template.title || '';
  form.elements.namedItem('description').value = template.description || '';
  form.elements.namedItem('twitch').checked = template.desiredPublication?.twitch === true;
  form.elements.namedItem('google').checked = template.desiredPublication?.google === true;
  $('slot-twitch-category').value = template.twitchCategoryName || '';
  $('slot-twitch-game-id').value = template.twitchCategoryId || '';
  $('slot-twitch-results').replaceChildren();
  ensureScheduleDefaults();
  return true;
}

function refreshTemplateSelect() {
  const select = $('event-template');
  if (!select) return;
  const selected = select.value;
  const templates = [...companion.snapshot().templates].sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'fr'));
  select.replaceChildren(new Option('Aucun', ''), ...templates.map(template => new Option(template.title || 'Template', template.id)));
  if (templates.some(template => template.id === selected)) select.value = selected;
}

function openPlanningFromTemplate(templateId) {
  const template = companion.snapshot().templates.find(item => item.id === templateId);
  if (!template) { note('Template introuvable.'); return; }
  document.querySelector('[data-tab="planning"]')?.click();
  const dialog = $('slot-dialog');
  if (dialog) dialog.dataset.mode = 'create';
  // Reuse the canonical "new event" entry point so mobile.js clears any previous
  // occurrence/series editing scope before we apply the template.
  $('add-slot')?.click();
  queueMicrotask(() => {
    const form = planningForm();
    if (!form) return;
    form.elements.namedItem('recurrence').disabled = false;
    form.elements.namedItem('recurrenceUntil').disabled = false;
    $('event-template').disabled = false;
    $('event-template').value = template.id;
    applyTemplate(template);
    ensureScheduleDefaults();
    $('slot-dialog-title').textContent = 'Nouvel événement';
    note(`Template « ${template.title} » appliqué. Choisis maintenant la périodicité et ajuste l’événement si besoin.`);
  });
}

function decorateTemplateCards() {
  const root = $('templates');
  if (!root) return;
  const templates = companion.snapshot().templates;
  const cards = [...root.querySelectorAll('.template-card')];
  cards.forEach((card, index) => {
    const template = templates[index];
    const use = card.querySelector('.template-actions button');
    if (!template || !use) return;
    if (use.textContent !== 'CRÉER UN ÉVÉNEMENT') use.textContent = 'CRÉER UN ÉVÉNEMENT';
    if (use.dataset.templateId !== template.id) use.dataset.templateId = template.id;
    use.onclick = event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openPlanningFromTemplate(template.id);
    };
  });
  const empty = root.querySelector('p.muted');
  if (empty?.textContent?.startsWith('Aucun template') && empty.textContent !== 'Aucun template d’événement pour le moment.') {
    empty.textContent = 'Aucun template d’événement pour le moment.';
  }
}

function harmonizePlanningCopy() {
  const root = $('planning');
  if (!root) return;
  for (const paragraph of root.querySelectorAll('p.muted')) {
    if (paragraph.textContent === 'Aucun rendez-vous.') paragraph.textContent = 'Aucun événement.';
  }
}

function editedItemFromForm() {
  const form = planningForm();
  if (!form) return null;
  const date = String(form.elements.namedItem('date')?.value || '');
  const start = String(form.elements.namedItem('start')?.value || '');
  const title = String(form.elements.namedItem('title')?.value || '').trim();
  if (!date || !start || !title) return null;
  const at = Date.parse(new Date(`${date}T${start}`).toISOString());
  if (!Number.isFinite(at)) return null;
  const items = expandRecurringItems(companion.snapshot().planning, { from: at - DAY_MS, to: at + DAY_MS });
  return items.find(item => item.title === title && Math.abs(Date.parse(item.startAtUtc) - at) < 60_000) || null;
}

function hydrateEditingFields() {
  const dialog = $('slot-dialog');
  const form = planningForm();
  if (!dialog?.open || dialog.dataset.mode !== 'edit' || !form) return;
  const item = editedItemFromForm();
  if (!item) return;
  form.elements.namedItem('twitch').checked = item.desiredPublication?.twitch === true;
  form.elements.namedItem('google').checked = item.desiredPublication?.google === true;
  $('slot-twitch-category').value = item.twitchCategoryName || '';
  $('slot-twitch-game-id').value = item.twitchCategoryId || '';
  $('slot-twitch-results').replaceChildren();
  // An existing event is independent from the template that may originally have
  // created it. Keep templates as a creation aid instead of a hidden dependency.
  $('event-template').value = '';
  $('event-template').disabled = true;
}

function updateDialogTitle() {
  const dialog = $('slot-dialog');
  const form = planningForm();
  if (!dialog?.open || !form) return;
  const title = $('slot-dialog-title');
  if (!title) return;
  if (dialog.dataset.mode === 'edit' && form.elements.namedItem('recurrence')?.disabled) title.textContent = 'Modifier cette occurrence';
  else if (dialog.dataset.mode === 'edit') title.textContent = 'Modifier l’événement';
  else title.textContent = 'Nouvel événement';
  hydrateEditingFields();
}

async function remoteTransport() {
  const credential = await credentialStorage.get();
  const server = settingsStorage.getServer();
  if (!credential || !server) throw new Error('Télécommande non connectée au PC.');
  return createTransport(() => server, () => credential);
}

async function startLiveFromPhone() {
  const button = $('stream');
  if (!button || button.disabled) return;
  const stopping = $('live')?.textContent?.trim() === 'LIVE';
  const question = stopping ? 'Arrêter réellement le live ?' : 'Démarrer réellement le live ?';
  if (!confirm(question)) return;

  const previousLabel = button.textContent;
  button.disabled = true;
  button.dataset.status = 'loading';
  try {
    const transport = await remoteTransport();
    if (stopping) {
      button.textContent = 'ARRÊT…';
      note('Arrêt du live…');
      const result = await transport.command({ type: 'session.stop' });
      button.textContent = 'DÉMARRER LE LIVE';
      globalThis.StreamDashboardNative?.haptic?.('strong');
      note(result.state?.obs?.streaming ? 'OBS signale encore un live actif.' : 'Live arrêté.');
      return;
    }

    button.textContent = 'PRÉPARATION…';
    note('Préparation du live…');
    const prepared = await transport.command({ type: 'session.prepare' });
    const preflight = prepared.state?.preflight;
    if (preflight?.status === 'error') note(`Préparation : ${preflight.error || 'une vérification demande ton attention.'}`);
    if (preflight?.status === 'action-required') note(preflight.error || 'Une action est nécessaire avant le live.');

    button.textContent = 'DÉMARRAGE…';
    let started;
    try {
      started = await transport.command({ type: 'session.start', force: false });
    } catch (error) {
      if (!String(error?.message || '').includes('Certaines vérifications')) throw error;
      if (!confirm(`${error.message}\n\nDémarrer quand même depuis le téléphone ?`)) {
        note('Démarrage annulé : checklist incomplète.');
        return;
      }
      started = await transport.command({ type: 'session.start', force: true });
    }

    button.textContent = started.state?.obs?.streaming ? 'ARRÊTER LE LIVE' : previousLabel;
    globalThis.StreamDashboardNative?.haptic?.('strong');
    note(started.state?.obs?.streaming ? 'Live démarré.' : 'Commande envoyée, en attente de confirmation OBS.');
  } catch (error) {
    note(`Impossible de lancer le live : ${error.message}`);
  } finally {
    button.dataset.status = 'idle';
    button.disabled = $('obs')?.textContent === 'Déconnecté';
    if (!button.disabled && !['ARRÊTER LE LIVE', 'DÉMARRER LE LIVE'].includes(button.textContent)) button.textContent = previousLabel;
  }
}

const templateSelect = $('event-template');
if (templateSelect) {
  templateSelect.onchange = () => {
    const template = companion.snapshot().templates.find(item => item.id === templateSelect.value);
    if (!template) return;
    if (!applyTemplate(template, { confirmOverwrite: true })) templateSelect.value = '';
    else note(`Template « ${template.title} » appliqué. La périodicité reste libre.`);
  };
}

$('add-slot')?.addEventListener('click', () => {
  const dialog = $('slot-dialog');
  if (dialog) dialog.dataset.mode = 'create';
  queueMicrotask(() => {
    if ($('event-template')) { $('event-template').disabled = false; $('event-template').value = ''; }
    $('slot-dialog-title').textContent = 'Nouvel événement';
    ensureScheduleDefaults();
  });
});

$('planning')?.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !/^Modifier/.test(button.textContent || '')) return;
  const dialog = $('slot-dialog');
  if (dialog) dialog.dataset.mode = 'edit';
}, true);
$('slot-dialog')?.addEventListener('close', () => {
  delete $('slot-dialog').dataset.mode;
  if ($('event-template')) $('event-template').disabled = false;
});

const streamButton = $('stream');
if (streamButton) streamButton.onclick = () => void startLiveFromPhone();

const templateObserver = new MutationObserver(() => queueMicrotask(() => { refreshTemplateSelect(); decorateTemplateCards(); }));
if ($('templates')) templateObserver.observe($('templates'), { childList: true, subtree: true });
const planningObserver = new MutationObserver(() => queueMicrotask(harmonizePlanningCopy));
if ($('planning')) planningObserver.observe($('planning'), { childList: true, subtree: true });
const dialogObserver = new MutationObserver(() => queueMicrotask(updateDialogTitle));
if ($('slot-dialog')) dialogObserver.observe($('slot-dialog'), { attributes: true, attributeFilter: ['open'] });

window.addEventListener('companion-refreshed', () => { refreshTemplateSelect(); decorateTemplateCards(); });
window.addEventListener('companion-mutated', () => { refreshTemplateSelect(); decorateTemplateCards(); });

refreshTemplateSelect();
decorateTemplateCards();
harmonizePlanningCopy();
