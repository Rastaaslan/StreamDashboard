import { thumbnailUrl, createThumbnailCache } from './thumbnails.js';
import { filterPlanning, weekAgenda } from './planning-model.js';

export const PLANNING_CANVAS = Object.freeze({ width: 1080, height: 1350 });
const { width: WIDTH, height: HEIGHT } = PLANNING_CANVAS;
const HEADER_BOTTOM = 210, FOOTER_HEIGHT = 90;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function rounded(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function setFont(ctx, weight, size, style = '') {
  ctx.font = `${style}${weight} ${size}px ${FONT}`;
}

/** Wraps by measured pixels, never by an arbitrary character count. */
export function wrapCanvasText(ctx, value, maxWidth, maxLines = 2) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) { line = candidate; continue; }
    if (line) lines.push(line);
    line = word;
    if (ctx.measureText(line).width > maxWidth) {
      let fitted = '';
      for (const character of line) {
        if (ctx.measureText(`${fitted}${character}…`).width > maxWidth) break;
        fitted += character;
      }
      line = `${fitted}…`;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  const consumed = lines.join(' ').length;
  if (consumed < String(value || '').trim().length && lines.length) {
    let last = lines.length - 1;
    while (lines[last] && ctx.measureText(`${lines[last]}…`).width > maxWidth) lines[last] = lines[last].slice(0, -1);
    lines[last] = `${lines[last].trimEnd()}…`;
  }
  return lines.slice(0, maxLines);
}

/** Selects the largest readable type size that fits within a fixed line box. */
export function fitCanvasText(ctx, value, { maxWidth, maxLines = 2, maxSize, minSize, weight = 700 }) {
  for (let size = maxSize; size >= minSize; size -= 1) {
    setFont(ctx, weight, size);
    const lines = wrapCanvasText(ctx, value, maxWidth, maxLines);
    if (lines.every(line => ctx.measureText(line).width <= maxWidth)) return { size, lines };
  }
  setFont(ctx, weight, minSize);
  return { size: minSize, lines: wrapCanvasText(ctx, value, maxWidth, maxLines) };
}

function fallbackTwitchArtworkUrl(item) {
  const categoryId = String(item?.twitchCategoryId || '').trim();
  if (!/^\d+$/.test(categoryId)) return '';
  return `https://static-cdn.jtvnw.net/ttv-boxart/${categoryId}-{width}x{height}.jpg`;
}

/** Loads remote artwork through a blob URL, so a permissive remote response cannot taint the canvas. */
const artworkCache = createThumbnailCache();
export function loadArtwork(url, options = {}) {
  const safe = thumbnailUrl(url);
  if (!safe) return Promise.resolve(null);
  // Injected transports have isolated lifetimes (tests and platform integrations).
  if (options.fetchApi || options.imageFactory) return fetchArtwork(safe, options);
  return artworkCache.load(safe, source => fetchArtwork(source, options), { refresh: options.refresh === true });
}

async function fetchArtwork(url, { timeoutMs = 3500, fetchApi = globalThis.fetch, imageFactory = () => new Image(), urlApi = globalThis.URL } = {}) {
  if (!url || !fetchApi || !urlApi?.createObjectURL) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let objectUrl, image;
  try {
    const response = await fetchApi(url, { signal: controller.signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'reload' });
    if (!response.ok) return null;
    objectUrl = urlApi.createObjectURL(await response.blob());
    image = imageFactory();
    await new Promise((resolve, reject) => {
      const imageTimeout = setTimeout(() => reject(new Error('Artwork timeout')), timeoutMs);
      image.onload = () => { clearTimeout(imageTimeout); resolve(); };
      image.onerror = error => { clearTimeout(imageTimeout); reject(error); };
      image.src = objectUrl;
    });
    return image;
  } catch { return null; }
  finally { clearTimeout(timeout); if (image) image.onload = image.onerror = null; if (objectUrl) urlApi.revokeObjectURL(objectUrl); }
}

export function drawCoverImage(ctx, image, box) {
  const { x, y, width, height, radius = 18 } = box;
  ctx.save(); rounded(ctx, x, y, width, height, radius); ctx.clip();
  if (image?.naturalWidth && image?.naturalHeight) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale, drawHeight = image.naturalHeight * scale;
    ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  } else {
    const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
    gradient.addColorStop(0, '#30234d'); gradient.addColorStop(1, '#171322');
    ctx.fillStyle = gradient; ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = 'rgba(207,186,255,.28)'; ctx.lineWidth = 2; ctx.strokeRect(x + 10, y + 10, width - 20, height - 20);
    ctx.fillStyle = '#bca8ff'; setFont(ctx, 800, Math.max(18, width * .18)); ctx.textAlign = 'center';
    ctx.fillText('◆', x + width / 2, y + height / 2 + width * .06); ctx.textAlign = 'left';
  }
  ctx.restore();
}

function drawLines(ctx, lines, x, y, lineHeight) { lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight)); }
function eventTime(item) { return new Date(item.startAtUtc).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }

export function calculateTodayCards(count) {
  const safeCount = Math.max(1, count);
  const top = 230, gap = 16, height = 170;
  return Array.from({ length: safeCount }, (_, index) => ({ x: 60, y: top + index * (height + gap), width: 960, height }));
}

export function calculateWeeklyCards(eventCount, rowY) {
  const count = Math.max(1, eventCount);
  const gap = 10, height = 94;
  return Array.from({ length: count }, (_, index) => ({
    x: 60, y: rowY + 32 + index * (height + gap), width: 960, height,
  }));
}

export function weeklyDayHeight(eventCount) {
  return eventCount ? 42 + eventCount * 104 : 118;
}

export function drawEventCard(ctx, item, card, image, compact = false) {
  const { x, y, width, height } = card;
  rounded(ctx, x, y, width, height, compact ? 18 : 24);
  ctx.fillStyle = compact ? 'rgba(255,255,255,.055)' : 'rgba(255,255,255,.072)'; ctx.fill();
  const pad = compact ? 10 : 18;
  const artHeight = height - pad * 2;
  const artWidth = compact ? 82 : Math.min(116, Math.round(artHeight * .76));
  const art = { x: x + pad, y: y + pad, width: artWidth, height: artHeight, radius: compact ? 11 : 16 };
  drawCoverImage(ctx, image, art);
  const textX = art.x + art.width + (compact ? 16 : 22);
  const timeWidth = compact ? (width > 700 ? 126 : 82) : 0;
  const textWidth = x + width - pad - timeWidth - (compact ? 14 : 0) - textX;
  if (compact) {
    const timeX = x + width - pad - timeWidth;
    rounded(ctx, timeX, y + 13, timeWidth, 38, 12);
    ctx.fillStyle = 'rgba(255,189,133,.13)'; ctx.fill();
    ctx.fillStyle = '#ffbd85'; setFont(ctx, 900, width > 700 ? 23 : 20); ctx.textAlign = 'center';
    ctx.fillText(eventTime(item), timeX + timeWidth / 2, y + 39); ctx.textAlign = 'left';
  } else {
    ctx.fillStyle = '#ffbd85'; setFont(ctx, 900, 31); ctx.fillText(eventTime(item), textX, y + 45);
  }
  if (!compact) {
    ctx.fillStyle = '#aaa2bb'; setFont(ctx, 600, 16); ctx.textAlign = 'right';
    ctx.fillText(new Date(item.startAtUtc).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }), x + width - pad, y + 42);
    ctx.textAlign = 'left';
  }
  const title = fitCanvasText(ctx, item.title || 'Live', { maxWidth: textWidth, maxLines: 2, maxSize: compact ? (width > 700 ? 25 : 21) : 28, minSize: compact ? 17 : 22, weight: 800 });
  ctx.fillStyle = '#fff'; setFont(ctx, 800, title.size); drawLines(ctx, title.lines, textX, y + (compact ? 32 : 80), compact ? title.size + 3 : title.size + 5);
  const categoryY = compact ? y + height - 13 : y + height - 22;
  const category = fitCanvasText(ctx, item.twitchCategoryName || 'Catégorie libre', { maxWidth: textWidth, maxLines: compact ? 1 : 2, maxSize: compact ? 16 : 19, minSize: compact ? 14 : 16, weight: 650 });
  ctx.fillStyle = '#cdbaff'; setFont(ctx, 650, category.size); drawLines(ctx, category.lines, textX, categoryY - (category.lines.length - 1) * (category.size + 3), category.size + 3);
  if (compact) {
    ctx.fillStyle = 'rgba(188,168,255,.45)'; ctx.fillRect(x + width - 4, y + 18, 4, height - 36);
  }
}

function drawHeader(ctx, streamer, weekly, height) {
  const gradient = ctx.createLinearGradient(0, 0, WIDTH, height);
  gradient.addColorStop(0, '#090914'); gradient.addColorStop(.62, '#18112c'); gradient.addColorStop(1, '#321827');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#bca8ff'; setFont(ctx, 750, 25); ctx.fillText('LE FEU DE CAMP', 70, 68);
  ctx.fillStyle = '#fff'; setFont(ctx, 850, 55); ctx.fillText(weekly ? 'AGENDA DE LA SEMAINE' : 'AUJOURD’HUI EN LIVE', 70, 137);
  ctx.fillStyle = '#aaa2bb'; setFont(ctx, 500, 23); ctx.fillText(streamer, 72, 180);
}

async function resolveImages(items, options) {
  const loader = options.loadArtwork || loadArtwork;
  return Promise.all(items.map(async item => {
    let url = item.twitchBoxArtUrl;
    if (!url && item.twitchCategoryId && options.resolveArtwork) {
      try { url = await options.resolveArtwork(item); } catch { /* fallback is intentional */ }
    }
    if (!url) url = fallbackTwitchArtworkUrl(item);
    try { return await loader(url, options.artworkOptions); } catch { return null; }
  }));
}

export async function renderPlanningCanvas(items, streamerName = 'StreamDashboard', options = {}) {
  const weekly = options.period === 'next-week' || options.period === 'this-week';
  const documentApi = options.documentApi || globalThis.document;
  const canvas = documentApi.createElement('canvas');
  let count = 0, footerY;
  let days, events;
  if (weekly) {
    days = weekAgenda(items, options.filters, options.now, options.period);
    count = days.reduce((total, day) => total + day.events.length, 0);
    const contentHeight = days.reduce((total, day) => total + weeklyDayHeight(day.events.length), 0);
    canvas.height = Math.max(PLANNING_CANVAS.height, HEADER_BOTTOM + contentHeight + FOOTER_HEIGHT);
  } else {
    events = filterPlanning(items, options.filters, 'today', options.now);
    if (!events.length) throw new Error('Aucun live aujourd’hui à exporter.');
    count = events.length;
    const cards = calculateTodayCards(events.length);
    const contentBottom = cards.at(-1).y + cards.at(-1).height;
    canvas.height = Math.max(PLANNING_CANVAS.height, contentBottom + FOOTER_HEIGHT);
  }
  canvas.width = WIDTH;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas indisponible.');
  drawHeader(ctx, streamerName, weekly, canvas.height);
  if (weekly) {
    const visible = days.flatMap(day => day.events);
    const images = await resolveImages(visible, options); let imageIndex = 0, y = 216;
    days.forEach(day => {
      ctx.fillStyle = '#cdbaff'; setFont(ctx, 800, 20); ctx.fillText(day.date.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' }).toUpperCase(), 65, y + 22);
      if (!day.events.length) {
        ctx.fillStyle = '#706a7d'; setFont(ctx, 550, 19); ctx.fillText('Pas de live prévu', 70, y + 72);
      } else {
        calculateWeeklyCards(day.events.length, y).forEach((card, eventIndex) => drawEventCard(ctx, day.events[eventIndex], card, images[imageIndex++], true));
      }
      y += weeklyDayHeight(day.events.length);
    });
    footerY = y + 24;
  } else {
    const images = await resolveImages(events, options);
    const cards = calculateTodayCards(events.length);
    cards.forEach((card, index) => drawEventCard(ctx, events[index], card, images[index]));
    footerY = cards.at(-1).y + cards.at(-1).height + 34;
  }
  if (options.noteEnabled && options.noteText) { ctx.fillStyle = '#aaa2bb'; setFont(ctx, 500, 20, 'italic '); ctx.fillText(options.noteText, 70, footerY); footerY += 37; }
  ctx.fillStyle = '#6f687e'; setFont(ctx, 500, 18); ctx.fillText('Planning prévisionnel · StreamDashboard', 70, Math.min(canvas.height - 24, footerY));
  return { canvas, count };
}

export const planningFileName = period => `planning-${period === 'next-week' ? 'semaine' : period === 'this-week' ? 'cette-semaine' : 'aujourdhui'}.png`;
async function blobBase64(blob) { const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); return btoa(binary); }
export async function sharePlanningPng(blob, fileName, nativeBridge = globalThis.StreamDashboardNative, navigatorApi = globalThis.navigator, documentApi = globalThis.document, urlApi = globalThis.URL) {
  if (nativeBridge?.shareImage) { const error = nativeBridge.shareImage(await blobBase64(blob), fileName, 'image/png'); if (error) throw new Error(error); return 'android'; }
  const file = new File([blob], fileName, { type: 'image/png' }); if (navigatorApi?.share && navigatorApi.canShare?.({ files: [file] })) { await navigatorApi.share({ files: [file], title: 'Planning des lives' }); return 'web-share'; }
  const url = urlApi.createObjectURL(blob); const anchor = documentApi.createElement('a'); anchor.href = url; anchor.download = file.name; anchor.click(); setTimeout(() => urlApi.revokeObjectURL(url), 1000); return 'download';
}

export async function exportPlanningImage(items, streamerName = 'StreamDashboard', options = {}) {
  const { blob, fileName, count } = await buildPlanningPng(items, streamerName, options);
  await sharePlanningPng(blob, fileName);
  return count;
}

export async function buildPlanningPng(items, streamerName = 'StreamDashboard', options = {}) {
  const { canvas, count } = await renderPlanningCanvas(items, streamerName, options);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Export PNG impossible.')), 'image/png'));
  return { blob, fileName: planningFileName(options.period), count };
}
