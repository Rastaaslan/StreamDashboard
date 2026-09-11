const WIDTH = 1080;
const HEIGHT = 1350;
const MAX_ROWS = 7;

export function selectPlanningRows(items, now = Date.now()) {
  return [...(items || [])]
    .filter(item => !item.allDay && (item.category === 'live' || item.kind === 'LIVE') && Date.parse(item.endAtUtc) > now)
    .sort((left, right) => Date.parse(left.startAtUtc) - Date.parse(right.startAtUtc))
    .slice(0, MAX_ROWS);
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth, maxLines = 2) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ['Live'];
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

function eventDate(item) {
  const start = new Date(item.startAtUtc);
  const day = start.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' }).replace('.', '');
  const time = start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`.toUpperCase();
}

function safeFileName(value) {
  return String(value || 'streamer').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'streamer';
}

export async function exportPlanningImage(items, streamerName = 'StreamDashboard') {
  const rows = selectPlanningRows(items);
  if (!rows.length) throw new Error('Aucun live futur à exporter.');

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible.');

  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, '#090914');
  gradient.addColorStop(0.55, '#151128');
  gradient.addColorStop(1, '#25123a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.globalAlpha = 0.18;
  for (let index = 0; index < 18; index++) {
    const x = 80 + ((index * 173) % 920);
    const y = 90 + ((index * 257) % 1170);
    const radius = 3 + (index % 4) * 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = index % 2 ? '#c55cff' : '#ff9b57';
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#bca8ff';
  ctx.font = '700 28px system-ui, sans-serif';
  ctx.fillText('LE FEU DE CAMP', 78, 92);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 68px system-ui, sans-serif';
  ctx.fillText('PLANNING DES LIVES', 78, 168);
  ctx.fillStyle = '#b6afc8';
  ctx.font = '500 28px system-ui, sans-serif';
  ctx.fillText(streamerName, 80, 215);

  const top = 275;
  const available = 930;
  const gap = 18;
  const rowHeight = Math.min(142, Math.floor((available - gap * (rows.length - 1)) / rows.length));

  rows.forEach((item, index) => {
    const y = top + index * (rowHeight + gap);
    roundRect(ctx, 70, y, 940, rowHeight, 28);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(188,168,255,0.24)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#bca8ff';
    ctx.font = '800 27px system-ui, sans-serif';
    ctx.fillText(eventDate(item), 105, y + 42);

    ctx.fillStyle = '#ffffff';
    ctx.font = '750 35px system-ui, sans-serif';
    const titleLines = wrapText(ctx, item.title, 690, rowHeight >= 125 ? 2 : 1);
    titleLines.forEach((line, lineIndex) => ctx.fillText(line, 105, y + 84 + lineIndex * 38));

    const category = item.twitchCategoryName?.trim();
    if (category) {
      ctx.fillStyle = '#ffbd85';
      ctx.font = '650 23px system-ui, sans-serif';
      const label = category.length > 26 ? `${category.slice(0, 25)}…` : category;
      ctx.textAlign = 'right';
      ctx.fillText(label, 970, y + 42);
      ctx.textAlign = 'left';
    }
  });

  ctx.fillStyle = '#7e7693';
  ctx.font = '500 22px system-ui, sans-serif';
  ctx.fillText('Planning généré avec StreamDashboard', 78, 1288);

  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Export PNG impossible.')), 'image/png'));
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `planning-${safeFileName(streamerName)}.png`;
    anchor.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return rows.length;
}
