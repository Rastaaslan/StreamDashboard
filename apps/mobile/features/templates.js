import { CompanionMode } from '../companion-store.js';
import { normalizeCategoryQuery, rankCategories, rememberCategory } from '../twitch-category.js';
import { getMobileContext } from '../mobile-context.js';

const $ = id => document.getElementById(id);
const { companion, transport, providerSync, ensureCredential, syncCompanion, getMode } = getMobileContext();
let editingId = null;
let observer;
let recentCategories = [];
const recentKey = 'streamdashboard.recentTwitchCategories';

try { recentCategories = JSON.parse(localStorage.getItem(recentKey) || '[]').slice(0, 8); } catch { recentCategories = []; }

const text = (tag, value, className) => {
  const node = document.createElement(tag);
  node.textContent = String(value ?? '');
  if (className) node.className = className;
  return node;
};

const notify = value => {
  const target = $('message');
  if (target) target.textContent = String(value || '');
};
const emitMutation = () => window.dispatchEvent(new CustomEvent('companion-mutated', { detail: { kind: 'templates' } }));

const currentMode = () => getMode();

function closeTemplateDialog() {
  editingId = null;
  $('template-form').reset();
  $('template-twitch-game-id').value = '';
  $('template-twitch-results').replaceChildren();
  $('template-dialog').close();
}

function openTemplateDialog(template) {
  editingId = template?.id || null;
  $('template-dialog-title').textContent = template ? 'Modifier le modèle' : 'Nouveau modèle';
  $('template-name').value = template?.title || '';
  $('template-description').value = template?.description || '';
  $('template-twitch-category').value = template?.twitchCategoryName || '';
  $('template-twitch-game-id').value = template?.twitchCategoryId || '';
  $('template-publish-twitch').checked = template?.desiredPublication?.twitch === true;
  $('template-publish-google').checked = template?.desiredPublication?.google === true;
  $('template-twitch-results').replaceChildren();
  $('template-dialog').showModal();
  $('template-name').focus();
}

function ensureScheduleDefaults() {
  const form = $('slot-form');
  const date = form.elements.namedItem('date');
  const start = form.elements.namedItem('start');
  const end = form.elements.namedItem('end');
  const category = form.elements.namedItem('category');
  if (category) category.value = 'live';
  if (date?.value && start?.value && end?.value) return;

  const now = new Date();
  const rounded = new Date(now);
  rounded.setSeconds(0, 0);
  const minutes = rounded.getMinutes();
  rounded.setMinutes(minutes < 30 ? 30 : 60);
  const finish = new Date(rounded.getTime() + 2 * 60 * 60 * 1000);
  const localDate = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  const localTime = value => `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  if (date && !date.value) date.value = localDate(rounded);
  if (start && !start.value) start.value = localTime(rounded);
  if (end && !end.value) end.value = localTime(finish);
}

function populateTemplate(template) {
  const form = $('slot-form');
  form.elements.namedItem('title').value = template.title || '';
  form.elements.namedItem('description').value = template.description || '';
  form.elements.namedItem('twitch').checked = template.desiredPublication?.twitch === true;
  form.elements.namedItem('google').checked = template.desiredPublication?.google === true;
  $('slot-twitch-category').value = template.twitchCategoryName || '';
  $('slot-twitch-game-id').value = template.twitchCategoryId || '';
  $('slot-twitch-results').replaceChildren();
  ensureScheduleDefaults();
}

function applyTemplate(template, { openPlanning = true } = {}) {
  if (!template) return;
  if (openPlanning) {
    document.querySelector('[data-tab="planning"]')?.click();
    $('add-slot')?.click();
    queueMicrotask(() => {
      populateTemplate(template);
      if ($('event-template')) $('event-template').value = template.id;
      notify(`Modèle « ${template.title} » appliqué. Ajuste la périodicité si besoin.`);
    });
    return;
  }
  populateTemplate(template);
  notify(`Modèle « ${template.title} » appliqué. La périodicité reste libre.`);
}

function templateSubtitle(template) {
  const parts = [];
  if (template.twitchCategoryName) parts.push(template.twitchCategoryName);
  if (template.desiredPublication?.twitch) parts.push('Twitch');
  if (template.desiredPublication?.google) parts.push('Google');
  return parts.join(' · ') || 'Sans publication automatique';
}

function renderTemplates() {
  const root = $('templates');
  if (!root) return;
  observer?.disconnect();
  root.replaceChildren();
  const templates = companion.snapshot().templates;
  for (const template of templates) {
    const row = document.createElement('div');
    row.className = 'template-card';
    const summary = document.createElement('div');
    summary.className = 'template-summary';
    summary.append(text('b', template.title), text('small', templateSubtitle(template), 'muted'));
    if (template.description) summary.append(text('span', template.description, 'template-description'));

    const actions = document.createElement('div');
    actions.className = 'template-actions';
    const use = text('button', 'CRÉER UN ÉVÉNEMENT');
    use.type = 'button';
    use.onclick = () => applyTemplate(template);
    const edit = text('button', 'Modifier');
    edit.type = 'button';
    edit.className = 'secondary';
    edit.onclick = () => openTemplateDialog(template);
    const remove = text('button', 'Supprimer');
    remove.type = 'button';
    remove.className = 'secondary danger-button';
    remove.onclick = () => {
      if (!confirm(`Supprimer le template « ${template.title} » ?`)) return;
      companion.removeCollection('templates', template.id);
      renderTemplates();
      emitMutation();
      if (currentMode() === CompanionMode.ONLINE_PC) void syncCompanion().catch(error => notify(error.message));
      notify('Template supprimé · synchronisation en cours.');
    };
    const menu = document.createElement('details'); menu.className = 'row-overflow template-overflow'; const menuToggle = text('summary', '⋮'); menuToggle.setAttribute('aria-label', `Actions pour ${template.title}`); menu.append(menuToggle, edit, remove);
    actions.append(use, menu);
    row.append(summary, actions);
    root.append(row);
  }
  if (!templates.length) root.append(text('p', 'Aucun modèle de live d’événement pour le moment.', 'muted'));
  refreshTemplateSelect();
  observer?.observe(root, { childList: true });
}

function refreshTemplateSelect() {
  const select = $('event-template');
  if (!select) return;
  const selected = select.value;
  const templates = [...companion.snapshot().templates].sort((left, right) => String(left.title || '').localeCompare(String(right.title || ''), 'fr'));
  select.replaceChildren(new Option('Aucun', ''), ...templates.map(template => new Option(template.title || 'Template', template.id)));
  if (templates.some(template => template.id === selected)) select.value = selected;
}

function attachTemplateCategoryPicker() {
  const input = $('template-twitch-category');
  const gameId = $('template-twitch-game-id');
  const results = $('template-twitch-results');
  let timer;
  let generation = 0;

  const show = items => {
    results.replaceChildren(...items.map(item => {
      const button = text('button', item.name);
      button.type = 'button';
      button.dataset.gameId = item.id;
      button.dataset.gameName = item.name;
      button.dataset.boxArtUrl = item.box_art_url || '';
      return button;
    }));
  };

  input.onfocus = () => { if (!input.value.trim()) show(recentCategories); };
  input.oninput = () => {
    gameId.value = '';
    clearTimeout(timer);
    const query = normalizeCategoryQuery(input.value);
    const request = ++generation;
    if (query.length < 2) { show(query ? [] : recentCategories); return; }
    results.replaceChildren(text('p', 'Recherche…', 'muted'));
    timer = setTimeout(async () => {
      try {
        await ensureCredential().catch(() => undefined);
        const response = await providerSync.searchCategories(currentMode(), query, recentCategories, value => transport.searchTwitch(value));
        const found = response.items || response;
        if (request !== generation) return;
        const ranked = rankCategories(found, recentCategories, query);
        show(ranked);
        if (!ranked.length) results.append(text('p', 'Aucune catégorie trouvée.', 'muted'));
      } catch (error) {
        if (request === generation) results.replaceChildren(text('p', error.message, 'danger'));
      }
    }, 300);
  };

  results.onclick = event => {
    const button = event.target.closest('[data-game-id]');
    if (!button) return;
    gameId.value = button.dataset.gameId;
    input.value = button.dataset.gameName;
    recentCategories = rememberCategory(recentCategories, { id: button.dataset.gameId, name: button.dataset.gameName, box_art_url: button.dataset.boxArtUrl || undefined });
    localStorage.setItem(recentKey, JSON.stringify(recentCategories));
    results.replaceChildren();
  };
}

$('add-template').onclick = () => openTemplateDialog();
$('close-template').onclick = closeTemplateDialog;
$('template-dialog').addEventListener('cancel', event => { event.preventDefault(); closeTemplateDialog(); });
$('template-form').onsubmit = event => {
  event.preventDefault();
  const existing = editingId ? companion.snapshot().templates.find(item => item.id === editingId) : null;
  const title = $('template-name').value.trim();
  const twitch = $('template-publish-twitch').checked;
  const google = $('template-publish-google').checked;
  if (!title) return;
  if (twitch && !$('template-twitch-game-id').value) {
    notify('Choisis une catégorie Twitch officielle pour ce template.');
    $('template-twitch-category').focus();
    return;
  }
  companion.upsertCollection('templates', {
    ...(existing || {}),
    title,
    description: $('template-description').value.trim(),
    twitchCategoryId: twitch ? $('template-twitch-game-id').value : '',
    twitchCategoryName: twitch ? $('template-twitch-category').value.trim() : '',
    desiredPublication: { twitch, google, local: false },
  });
  closeTemplateDialog();
  renderTemplates();
  emitMutation();
  if (currentMode() === CompanionMode.ONLINE_PC) void syncCompanion().catch(error => notify(error.message));
  notify(existing ? 'Template modifié · synchronisation en cours.' : 'Template créé · synchronisation en cours.');
};

const eventTemplate = $('event-template');
if (eventTemplate) {
  eventTemplate.onchange = () => {
    const template = companion.snapshot().templates.find(item => item.id === eventTemplate.value);
    if (template) applyTemplate(template, { openPlanning: false });
  };
}

attachTemplateCategoryPicker();
observer = new MutationObserver(() => queueMicrotask(renderTemplates));
window.addEventListener('companion-refreshed', renderTemplates);
window.addEventListener('companion-mutated', event => { if (event.detail?.kind === 'templates') renderTemplates(); });
renderTemplates();
