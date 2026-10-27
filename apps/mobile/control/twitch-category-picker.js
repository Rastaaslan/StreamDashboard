function categories(value) {
  const items = Array.isArray(value) ? value : value?.items ?? value?.data;
  if (!Array.isArray(items)) throw new Error('Réponse Twitch illisible. Réessayez la recherche.');
  const seen = new Set();
  return items.filter(item => item && typeof item.id === 'string' && /^\d{1,30}$/.test(item.id)
    && typeof item.name === 'string' && item.name.trim() && item.name.length <= 200)
    .filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
}

/** A dialog owns its requests; no result may cross a source or a newer selection. */
export function createTwitchCategoryPicker(form, { request, isCurrent = () => true, remember = () => {}, initialName = '' } = {}) {
  const query = form.querySelector('#twitch-game-query');
  const selection = form.elements.twitchGameId;
  const label = form.querySelector('#twitch-game-selected');
  const results = form.querySelector('#category-results');
  const button = form.querySelector('[data-twitch-category-search]');
  let sequence = 0, selectionRevision = 0;
  const current = () => form.isConnected && isCurrent();
  function showSelection(name) {
    label.textContent = name ? 'Jeu sélectionné : ' + name : selection.value ? 'Catégorie enregistrée · vérification du nom…' : 'Aucune catégorie sélectionnée';
    label.className = 'small ' + (name ? 'succeeded' : 'muted');
  }
  showSelection(initialName);
  if (selection.value && !initialName) {
    const id = selection.value, revision = selectionRevision;
    void Promise.resolve().then(() => current() ? request('/api/v1/twitch/categories?id=' + encodeURIComponent(id)) : []).then(value => {
      if (!current() || revision !== selectionRevision || selection.value !== id) return;
      const game = categories(value).find(item => item.id === id);
      if (!game) throw new Error('Catégorie introuvable');
      remember(game); showSelection(game.name);
    }).catch(() => {
      if (!current() || revision !== selectionRevision || selection.value !== id) return;
      label.textContent = 'Catégorie enregistrée · nom indisponible pour le moment. Recherchez son nom pour la modifier.';
      label.className = 'small muted';
    });
  }
  async function search() {
    if (!current()) return;
    const text = query.value.trim();
    const revision = ++sequence;
    results.replaceChildren();
    if (!text || text.length > 80) {
      results.textContent = text ? 'Saisissez au maximum 80 caractères.' : 'Saisissez le nom du jeu ou de la catégorie Twitch.';
      query.focus(); return;
    }
    button.disabled = true; results.textContent = 'Recherche sur Twitch…';
    try {
      const items = categories(await request('/api/v1/twitch/categories?q=' + encodeURIComponent(text)));
      if (!current() || revision !== sequence || query.value.trim() !== text) return;
      results.replaceChildren();
      if (!items.length) { results.textContent = 'Aucun jeu trouvé. Essayez un autre nom.'; return; }
      for (const game of items) {
        const choice = document.createElement('button');
        choice.type = 'button'; choice.className = 'secondary'; choice.textContent = game.name;
        choice.addEventListener('click', () => {
          if (!current() || revision !== sequence) return;
          selectionRevision++; sequence++;
          selection.value = game.id; query.value = game.name;
          remember(game); showSelection(game.name); results.replaceChildren();
        });
        results.append(choice);
      }
    } catch (error) {
      if (current() && revision === sequence && query.value.trim() === text) results.textContent = error?.message || 'Recherche Twitch indisponible. Réessayez.';
    } finally {
      if (current() && revision === sequence) button.disabled = false;
    }
  }
  button.addEventListener('click', () => { void search(); });
  query.addEventListener('input', () => { sequence++; button.disabled = false; results.replaceChildren(); });
  query.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void search(); }
  });
  return { search };
}
