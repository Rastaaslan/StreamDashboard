import { filterPlanning, weekAgenda } from './planning-model.js';

export const PLANNING_CANVAS = Object.freeze({ width: 1080, height: 1350 });
const { width: WIDTH, height: HEIGHT } = PLANNING_CANVAS;
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

function twitchArtworkUrl(value, width = 285, height = 380) {
  return String(value || '').replace('{width}', String(width)).replace('{height}', String(height));
}

/** Loads remote artwork through a blob URL, so a permissive remote response cannot taint the canvas. */
export async function loadArtwork(url, { timeoutMs = 3500, fetchApi = globalThis.fetch, imageFactory = () => new Image(), urlApi = globalThis.URL } = {}) {
  if (!url || !fetchApi || !urlApi?.createObjectURL) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let objectUrl;
  try {
    const response = await fetchApi(twitchArtworkUrl(url), { signal: controller.signal, mode: 'cors', credentials: 'omit' });
    if (!response.ok) return null;
    objectUrl = urlApi.createObjectURL(await response.blob());
    const image = imageFactory();
    await new Promise((resolve, reject) => {
      const imageTimeout = setTimeout(() => reject(new Error('Artwork timeout')), timeoutMs);
      image.onload = () => { clearTimeout(imageTimeout); resolve(); };
      image.onerror = error => { clearTimeout(imageTimeout); reject(error); };
      image.src = objectUrl;
    });
    return image;
  } catch { return null; }
  finally { clearTimeout(timeout); if (objectUrl) urlApi.revokeObjectURL(objectUrl); }
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
  const safeCount = Math.max(1, Math.min(5, count));
  const top = 230, bottom = 1240, gap = safeCount === 5 ? 14 : 20;
  const height = Math.min(190, (bottom - top - gap * (safeCount - 1)) / safeCount);
  return Array.from({ length: safeCount }, (_, index) => ({ x: 60, y: top + index * (height + gap), width: 960, height }));
}

export function calculateWeeklyCards(eventCount, rowY) {
  const count = Math.max(1, Math.min(2, eventCount));
  const gap = 12;
  const width = (960 - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, index) => ({
    x: 60 + index * (width + gap), y: rowY + 29, width, height: 108,
  }));
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

function drawHeader(ctx, streamer, weekly) {
  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
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
    try { return await loader(url, options.artworkOptions); } catch { return null; }
  }));
}

export async function renderPlanningCanvas(items, streamerName = 'StreamDashboard', options = {}) {
  const weekly = options.period === 'next-week';
  const documentApi = options.documentApi || globalThis.document;
  const canvas = documentApi.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas indisponible.');
  drawHeader(ctx, streamerName, weekly);
  let count = 0;
  if (weekly) {
    const days = weekAgenda(items, options.filters, options.now);
    const visible = days.flatMap(day => day.events.slice(0, 2));
    const images = await resolveImages(visible, options); let imageIndex = 0;
    days.forEach((day, index) => {
      const y = 216 + index * 143;
      ctx.fillStyle = '#cdbaff'; setFont(ctx, 800, 20); ctx.fillText(day.date.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' }).toUpperCase(), 65, y + 22);
      if (!day.events.length) { ctx.fillStyle = '#706a7d'; setFont(ctx, 550, 19); ctx.fillText('Pas de live prévu', 70, y + 75); }
      else {
        const entries = day.events.slice(0, 2);
        calculateWeeklyCards(entries.length, y).forEach((card, eventIndex) => drawEventCard(ctx, entries[eventIndex], card, images[imageIndex++], true));
        count += day.events.length;
      }
    });
  } else {
    const events = filterPlanning(items, options.filters, 'today', options.now);
    if (!events.length) throw new Error('Aucun live aujourd’hui à exporter.');
    const shown = events.slice(0, 5); const images = await resolveImages(shown, options);
    calculateTodayCards(shown.length).forEach((card, index) => drawEventCard(ctx, shown[index], card, images[index]));
    count = events.length;
  }
  if (options.noteEnabled && options.noteText) { ctx.fillStyle = '#aaa2bb'; setFont(ctx, 500, 20, 'italic '); ctx.fillText(options.noteText, 70, 1288); }
  ctx.fillStyle = '#6f687e'; setFont(ctx, 500, 18); ctx.fillText('Planning prévisionnel · StreamDashboard', 70, 1325);
  return { canvas, count };
}

export const planningFileName = period => `planning-${period === 'next-week' ? 'semaine' : 'aujourdhui'}.png`;
async function blobBase64(blob) { const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); return btoa(binary); }
export async function sharePlanningPng(blob, fileName, nativeBridge = globalThis.StreamDashboardNative, navigatorApi = globalThis.navigator, documentApi = globalThis.document, urlApi = globalThis.URL) {
  if (nativeBridge?.shareImage) { const error = nativeBridge.shareImage(await blobBase64(blob), fileName, 'image/png'); if (error) throw new Error(error); return 'android'; }
  const file = new File([blob], fileName, { type: 'image/png' }); if (navigatorApi?.share && navigatorApi.canShare?.({ files: [file] })) { await navigatorApi.share({ files: [file], title: 'Planning des lives' }); return 'web-share'; }
  const url = urlApi.createObjectURL(blob); const anchor = documentApi.createElement('a'); anchor.href = url; anchor.download = file.name; anchor.click(); setTimeout(() => urlApi.revokeObjectURL(url), 1000); return 'download';
}

export async function exportPlanningImage(items, streamerName = 'StreamDashboard', options = {}) {
  const { canvas, count } = await renderPlanningCanvas(items, streamerName, options);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Export PNG impossible.')), 'image/png'));
  await sharePlanningPng(blob, planningFileName(options.period));
  return count;
}
