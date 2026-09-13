import { filterPlanningTemporal, paginatePlanning, TEMPORAL_FILTERS } from '../mobile/planning-model.js';

const STORAGE_KEY = 'streamdashboard.desktopPlanningList';
const PAGE_SIZE = 8;
let preferences = { temporal: TEMPORAL_FILTERS.UPCOMING };
let page = 1;
let currentState = null;
let refreshScheduled = false;
let requestGeneration = 0;

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  if (Object.values(TEMPORAL_FILTERS).includes(saved.temporal)) preferences.temporal = saved.temporal;
} catch { /* invalid preference: keep defaults */ }

const view = document.getElementById('view');

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

function controlsFor(schedule) {
  const parent = schedule.parentElement;
  let controls = parent?.querySelector('#planning-list-controls');
  if (controls) return controls;
  controls = document.createElement('div');
  controls.id = 'planning-list-controls';
  controls.className = 'panel space';
  controls.innerHTML = `
    <div class="section-head">
      <label>Temporalité
        <select id="planning-temporal-filter">
          <option value="upcoming">À venir</option>
          <option value="past">Passés</option>
          <option value="all">Tous</option>
        </select>
      </label>
      <div class="button-row">
        <button class="ghost compact" id="planning-page-prev" type="button">← Précédent</button>
        <small class="muted" id="planning-page-label"></small>
        <button class="ghost compact" id="planning-page-next" type="button">Suivant →</button>
      </div>
    </div>`;
  parent?.insertBefore(controls, schedule);
  const select = controls.querySelector('#planning-temporal-filter');
  select.value = preferences.temporal;
  select.onchange = () => {
    preferences.temporal = select.value;
    page = 1;
    persist();
    applyCurrentState();
  };
  controls.querySelector('#planning-page-prev').onclick = () => { page -= 1; applyCurrentState(); };
  controls.querySelector('#planning-page-next').onclick = () => { page += 1; applyCurrentState(); };
  return controls;
}

function applyCurrentState() {
  const schedule = view?.querySelector('.schedule');
  if (!schedule || !currentState?.planning) return;
  const articles = [...schedule.querySelectorAll(':scope > article')];
  const sorted = [...currentState.planning].sort((left, right) => Date.parse(left.startAtUtc) - Date.parse(right.startAtUtc));
  if (articles.length !== sorted.length) return;

  const byId = new Map();
  articles.forEach((article, index) => {
    const item = sorted[index];
    article.dataset.planningId = item.id;
    byId.set(item.id, article);
    article.hidden = true;
    article.style.display = 'none';
    article.style.order = '9999';
  });

  const filtered = filterPlanningTemporal(sorted, preferences.temporal, new Date());
  const pagination = paginatePlanning(filtered, page, PAGE_SIZE);
  page = pagination.page;
  pagination.items.forEach((item, index) => {
    const article = byId.get(item.id);
    if (!article) return;
    article.hidden = false;
    article.style.removeProperty('display');
    article.style.order = String(index);
  });

  const controls = controlsFor(schedule);
  controls.querySelector('#planning-temporal-filter').value = preferences.temporal;
  const label = controls.querySelector('#planning-page-label');
  label.textContent = `${pagination.total} événement${pagination.total > 1 ? 's' : ''} · page ${pagination.page}/${pagination.totalPages}`;
  const prev = controls.querySelector('#planning-page-prev');
  const next = controls.querySelector('#planning-page-next');
  prev.disabled = pagination.page <= 1;
  next.disabled = pagination.page >= pagination.totalPages;
  const title = view.querySelector('.section-head h3');
  const nextTitle = preferences.temporal === TEMPORAL_FILTERS.PAST
    ? 'Historique'
    : preferences.temporal === TEMPORAL_FILTERS.ALL
      ? 'Tous les rendez-vous'
      : 'Prochains rendez-vous';
  if (title && title.textContent !== nextTitle) title.textContent = nextTitle;
}

async function refresh() {
  refreshScheduled = false;
  const schedule = view?.querySelector('.schedule');
  if (!schedule) return;
  const generation = ++requestGeneration;
  try {
    const response = await fetch('/api/v1/state', { headers: { accept: 'application/json' } });
    if (!response.ok) return;
    const state = await response.json();
    if (generation !== requestGeneration) return;
    currentState = state;
    applyCurrentState();
  } catch { /* desktop planning keeps working without enhancement */ }
}

function scheduleRefresh() {
  if (refreshScheduled) return;
  refreshScheduled = true;
  queueMicrotask(() => void refresh());
}

// StreamDashboard remplace directement le contenu de #view à chaque rendu.
// Observer uniquement ses enfants directs évite qu'une modification interne
// (titre, pagination, masquage des lignes) relance une boucle de refresh.
new MutationObserver(scheduleRefresh).observe(view, { childList: true });
scheduleRefresh();
