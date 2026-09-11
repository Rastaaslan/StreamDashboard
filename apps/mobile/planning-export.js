const WIDTH = 1080;
const HEIGHT = 1350;

function rows(items) {
  const now = Date.now();
  return [...(items || [])]
    .filter(item => !item.allDay && (item.category === 'live' || item.kind === 'LIVE') && Date.parse(item.endAtUtc) > now)
    .sort((left, right) => Date.parse(left.startAtUtc) - Date.parse(right.startAtUtc))
    .slice(0, 7);
}

function label(item) {
  const start = new Date(item.startAtUtc);
  return `${start.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })} · ${start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`.toUpperCase();
}

function rounded(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function safeName(value) {
  return String(value || 'streamer').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'streamer';
}

export async function exportPlanningImage(items, streamerName = 'StreamDashboard') {
  const events = rows(items);
  if (!events.length) throw new Error('Aucun live futur à exporter.');

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
  const gap = 18;
  const rowHeight = Math.min(142, Math.floor((930 - gap * (events.length - 1)) / events.length));

  events.forEach((item, index) => {
    const y = top + index * (rowHeight + gap);
    rounded(ctx, 70, y, 940, rowHeight, 28);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(188,168,255,0.24)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#bca8ff';
    ctx.font = '800 27px system-ui, sans-serif';
    ctx.fillText(label(item), 105, y + 42);
    ctx.fillStyle = '#ffffff';
    ctx.font = '750 35px system-ui, sans-serif';
    const title = String(item.title || 'Live');
    ctx.fillText(title.length > 36 ? `${title.slice(0, 35)}…` : title, 105, y + 88);
  });

  ctx.fillStyle = '#7e7693';
  ctx.font = '500 22px system-ui, sans-serif';
  ctx.fillText('Planning généré avec StreamDashboard', 78, 1288);

  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Export PNG impossible.')), 'image/png'));
  const file = new File([blob], `planning-${safeName(streamerName)}.png`, { type: 'image/png' });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'Planning des lives' });
    return events.length;
  }

  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return events.length;
}
