const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const toast = message => {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 1800);
};

const go = target => {
  $$('.screen').forEach(screen => screen.classList.toggle('active', screen.dataset.screen === target));
  $$('[data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === target));
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

$$('[data-nav]').forEach(button => button.addEventListener('click', () => go(button.dataset.nav)));
$$('[data-go]').forEach(button => button.addEventListener('click', () => go(button.dataset.go)));

$('#open-camp').addEventListener('click', () => { $('#camp-sheet').hidden = false; });
$$('[data-close-camp]').forEach(button => button.addEventListener('click', () => { $('#camp-sheet').hidden = true; }));
$$('.camp-row').forEach(button => button.addEventListener('click', () => toast('Aperçu uniquement · section secondaire')));

$$('[data-demo]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.demo === 'mic') {
    button.classList.toggle('active');
    button.querySelector('small').textContent = button.classList.contains('active') ? 'Actif · -8 dB' : 'Coupé';
    toast(button.classList.contains('active') ? 'Micro activé (simulation)' : 'Micro coupé (simulation)');
    return;
  }
  toast(button.dataset.demo === 'clip' ? 'Clip créé (simulation)' : 'Pause activée (simulation)');
}));

const selectScene = scene => {
  $('[data-scene]').forEach(item => item.classList.toggle('selected', item.dataset.scene === scene));
  $('#scene-name').textContent = scene;
  const homeScene = $('#home-scene-name');
  if (homeScene) homeScene.textContent = scene;
  toast(`Scène → ${scene} (simulation)`);
};
$('[data-scene]').forEach(button => button.addEventListener('click', () => selectScene(button.dataset.scene)));

$$('[data-audio]').forEach(button => button.addEventListener('click', () => {
  button.classList.toggle('on');
  toast(button.classList.contains('on') ? 'Source audio réactivée' : 'Source audio coupée');
}));

let seconds = 300;
let timerRunning = false;
let timerHandle = null;
const renderTimer = () => {
  const minutes = Math.floor(Math.max(seconds, 0) / 60);
  const rest = Math.max(seconds, 0) % 60;
  $('#timer-value').textContent = `${String(minutes).padStart(2,'0')}:${String(rest).padStart(2,'0')}`;
};
$$('[data-timer]').forEach(button => button.addEventListener('click', () => {
  seconds = Math.max(0, seconds + Number(button.dataset.timer));
  renderTimer();
}));
$('#timer-toggle').addEventListener('click', () => {
  timerRunning = !timerRunning;
  $('#timer-toggle').textContent = timerRunning ? 'Ⅱ' : '▶';
  if (timerHandle) clearInterval(timerHandle);
  if (timerRunning) timerHandle = setInterval(() => {
    seconds = Math.max(0, seconds - 1);
    renderTimer();
    if (seconds === 0) {
      timerRunning = false;
      clearInterval(timerHandle);
      $('#timer-toggle').textContent = '▶';
      toast('Minuteur terminé');
    }
  }, 1000);
});

$('#stop-live').addEventListener('click', () => toast('Arrêt du live désactivé dans l’aperçu'));
$('#add-event').addEventListener('click', () => toast('Création d’événement · aperçu'));
$('.export-button').addEventListener('click', () => toast('Image planning générée · aperçu'));

$$('#week-strip button').forEach(button => button.addEventListener('click', () => {
  $$('#week-strip button').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
}));

const soundPads = $$('.sound-pad');
soundPads.forEach(button => button.addEventListener('click', () => {
  soundPads.forEach(item => item.classList.remove('playing'));
  button.classList.add('playing');
  toast(`${button.dataset.name} · lecture simulée`);
  setTimeout(() => button.classList.remove('playing'), 900);
}));

const applySoundFilter = () => {
  const active = $('#sound-filters .active')?.dataset.filter || 'all';
  const query = $('#sound-search').value.trim().toLowerCase();
  soundPads.forEach(pad => {
    const matchQuery = !query || pad.dataset.name.toLowerCase().includes(query);
    const matchFilter = active === 'all'
      || (active === 'fav' && pad.classList.contains('favorite'))
      || pad.dataset.kind === active;
    pad.hidden = !(matchQuery && matchFilter);
  });
};
$$('#sound-filters button').forEach(button => button.addEventListener('click', () => {
  $$('#sound-filters button').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  applySoundFilter();
}));
$('#sound-search').addEventListener('input', applySoundFilter);

const quickSoundStorageKey = 'streamdashboard.preview.quickSounds';
const defaultQuickSounds = [
  { name: 'BONK', category: 'Réactions' },
  { name: 'GG', category: 'Réactions' },
  { name: 'CREEPER', category: 'Minecraft' },
  { name: 'TNT', category: 'Minecraft' },
];
let quickSounds = defaultQuickSounds;
try {
  const saved = JSON.parse(localStorage.getItem(quickSoundStorageKey) || 'null');
  if (Array.isArray(saved) && saved.every(item => item?.name && item?.category)) quickSounds = saved;
} catch {}
let quickSoundCategory = quickSounds[0]?.category || 'Réactions';

const saveQuickSounds = () => localStorage.setItem(quickSoundStorageKey, JSON.stringify(quickSounds));
const renderQuickSounds = () => {
  const categoryHost = $('#quick-sound-categories');
  const soundHost = $('#quick-sound-grid');
  if (!categoryHost || !soundHost) return;
  const categories = [...new Set(quickSounds.map(item => item.category))];
  if (!categories.includes(quickSoundCategory)) quickSoundCategory = categories[0] || '';
  categoryHost.replaceChildren(...categories.map(category => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = category;
    button.classList.toggle('active', category === quickSoundCategory);
    button.addEventListener('click', () => {
      quickSoundCategory = category;
      renderQuickSounds();
    });
    return button;
  }));
  soundHost.replaceChildren();
  const visible = quickSounds.filter(item => item.category === quickSoundCategory);
  for (const sound of visible) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quick-sound-button';
    button.innerHTML = `<b></b><small></small><span class="sound-glyph">♫</span>`;
    button.querySelector('b').textContent = sound.name;
    button.querySelector('small').textContent = sound.category;
    button.addEventListener('click', () => {
      $$('.quick-sound-button').forEach(item => item.classList.remove('playing'));
      button.classList.add('playing');
      toast(`${sound.name} · lecture simulée`);
      setTimeout(() => button.classList.remove('playing'), 850);
    });
    soundHost.append(button);
  }
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'quick-sound-empty';
    empty.textContent = 'Aucun son dans cette catégorie.';
    soundHost.append(empty);
  }
};

const quickSoundDialog = $('#quick-sound-dialog');
$('#add-quick-sound')?.addEventListener('click', () => {
  $('#quick-sound-category').value = quickSoundCategory || 'Réactions';
  quickSoundDialog.showModal();
});
$('#close-quick-sound')?.addEventListener('click', () => quickSoundDialog.close());
$('#cancel-quick-sound')?.addEventListener('click', () => quickSoundDialog.close());
$('#quick-sound-form')?.addEventListener('submit', event => {
  event.preventDefault();
  const name = $('#quick-sound-choice').value.trim();
  const category = $('#quick-sound-category').value.trim() || 'Sans catégorie';
  const existing = quickSounds.find(item => item.name === name);
  if (existing) existing.category = category;
  else quickSounds.push({ name, category });
  quickSoundCategory = category;
  saveQuickSounds();
  renderQuickSounds();
  quickSoundDialog.close();
  toast(`${name} ajouté à ${category}`);
});
renderQuickSounds();
