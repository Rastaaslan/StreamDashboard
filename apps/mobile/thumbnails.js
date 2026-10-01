/** Only public Twitch CDN assets may leave the application. Never forward query tokens. */
export const TWITCH_IMAGE_HOSTS = ['static-cdn.jtvnw.net', 'clips-media-assets2.twitch.tv', 'clips-media-assets.twitch.tv'];
export function thumbnailUrl(value, context = 'planning') {
  if (typeof value !== 'string' || !value) return '';
  const [width, height] = context === 'planning' ? [285, 380] : [640, 360];
  try {
    const url = new URL(value.replace(/%\{width\}|\{width\}/g, width).replace(/%\{height\}|\{height\}/g, height));
    if (url.protocol !== 'https:' || !TWITCH_IMAGE_HOSTS.includes(url.hostname) || url.username || url.password || url.port) return '';
    url.search = ''; url.hash = '';
    return url.href;
  } catch { return ''; }
}

export function selectThumbnail(item = {}, context = 'planning') {
  const category = item.twitchBoxArtUrl || item.box_art_url || item.category?.box_art_url;
  const categoryId = String(item.twitchCategoryId || item.categoryId || '');
  const fallback = /^\d+$/.test(categoryId) ? `https://static-cdn.jtvnw.net/ttv-boxart/${categoryId}-{width}x{height}.jpg` : '';
  const candidates = context === 'planning' ? [category, fallback] : [item.thumbnailUrl, item.thumbnail_url, category, fallback];
  return candidates.map(value => thumbnailUrl(value, context)).find(Boolean) || '';
}

/** In-memory only: bounded, coalesced requests; failed entries retry after 30 seconds. */
export function createThumbnailCache({ now = Date.now, ttl = 300000, failureTtl = 30000, limit = 128 } = {}) {
  const entries = new Map();
  return {
    invalidate(key) { if (key === undefined) entries.clear(); else entries.delete(key); },
    load(key, loader, { refresh = false } = {}) {
      if (!key) return Promise.resolve(null);
      const cached = entries.get(key);
      if (cached && (!refresh || cached.pending) && (cached.pending || cached.expires > now())) return cached.promise;
      const entry = { pending: true, expires: Infinity, promise: null };
      entry.promise = Promise.resolve().then(() => loader(key, refresh)).catch(() => null).then(value => {
        entry.pending = false; entry.expires = now() + (value ? ttl : failureTtl);
        return value || null;
      });
      entries.delete(key); entries.set(key, entry);
      while (entries.size > limit) entries.delete(entries.keys().next().value);
      return entry.promise;
    },
  };
}

const cache = createThumbnailCache();
let refreshSequence = 0;
export function loadThumbnail(url, { refresh = false, imageFactory = () => new Image(), timeoutMs = 3500 } = {}) {
  const safe = thumbnailUrl(url);
  return cache.load(safe, (source, reload) => new Promise(resolve => {
    const image = imageFactory();
    const finish = value => { clearTimeout(timer); image.onload = image.onerror = null; resolve(value); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    image.crossOrigin = 'anonymous'; image.referrerPolicy = 'no-referrer';
    image.onload = () => finish(image.naturalWidth && image.naturalHeight ? image : null);
    image.onerror = () => finish(null);
    // Time bucket avoids a distinct browser cache entry on every render.
    image.src = `${source}?sd-thumb=${Math.floor(Date.now() / 300000)}${reload ? `-retry-${++refreshSequence}` : ''}`;
  }), { refresh });
}

/** Keep the placeholder visible until decoding succeeds: never attach a broken image. */
export function createThumbnail(item, context = 'planning', { documentApi = document, loader = loadThumbnail } = {}) {
  const root = documentApi.createElement('div'); root.className = `twitch-thumbnail ${context === 'planning' ? 'portrait' : 'landscape'}`;
  const placeholder = documentApi.createElement('span'); placeholder.textContent = '◆'; placeholder.setAttribute('role', 'img'); placeholder.setAttribute('aria-label', 'Aperçu indisponible');
  const retry = documentApi.createElement('button'); retry.type = 'button'; retry.textContent = '↻'; retry.setAttribute('aria-label', 'Rafraîchir la miniature');
  const source = selectThumbnail(item, context);
  root.append(placeholder);
  if (!source) return root;
  root.append(retry);
  let generation = 0;
  const render = async refresh => {
    const current = ++generation; retry.disabled = true;
    let image;
    try { image = await loader(source, { refresh }); } catch { image = null; }
    if (current !== generation) return;
    root.replaceChildren(placeholder, retry);
    if (image) {
      // A canvas reuses decoded pixels without issuing another image request.
      const canvas = documentApi.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      try { canvas.getContext('2d').drawImage(image, 0, 0); canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Aperçu Twitch'); root.replaceChildren(canvas, retry); } catch { /* retain placeholder */ }
    }
    retry.disabled = false;
  };
  retry.onclick = event => { event.stopPropagation(); void render(true); };
  retry.onkeydown = event => event.stopPropagation();
  void render(false);
  return root;
}
