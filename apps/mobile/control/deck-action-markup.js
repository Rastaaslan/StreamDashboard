/**
 * One layout for live/deck action buttons on Android and desktop.
 * Keep title, current state and shortcut as separate, semantic rows.
 */
const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);
const comparable = value => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function deckActionParts({label='', status='', shortcut='', icon='◇'}={}) {
  let title = String(label || '').trim() || 'Action';
  const picture = String(icon || '').trim();
  // Never remove an emoji simply because its normalized form is empty.
  if (picture && title.startsWith(picture) && title.length > picture.length) {
    title = title.slice(picture.length).trim() || title;
  }
  let state = String(status || '').trim();
  const a = comparable(title), b = comparable(state);
  if (a && a === b) {
    state = '';
  } else if (a && b.startsWith(a + ' ') &&
    state.toLocaleLowerCase('fr').startsWith(title.toLocaleLowerCase('fr') + ' ')) {
    state = state.slice(title.length).replace(/^[\s·:–—-]+/, '').trim();
  }
  const key = String(shortcut || '').trim().replace(/^Control\+Alt\+Shift\+/i, 'M / ');
  return {title, state, shortcut: key, icon: picture};
}

export function deckActionMarkup(input) {
  const {title, state, shortcut, icon} = deckActionParts(input);
  return (icon ? '<span class="sd-action-pad-icon" aria-hidden="true">'+html(icon)+'</span>' : '') +
    '<span class="sd-action-pad-title">'+html(title)+'</span>' +
    (state ? '<small class="sd-action-pad-state">'+html(state)+'</small>' : '') +
    (shortcut ? '<small class="sd-action-pad-shortcut">'+html(shortcut)+'</small>' : '');
}
