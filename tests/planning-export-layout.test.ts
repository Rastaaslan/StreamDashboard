import { describe, expect, it, vi } from 'vitest';
import { calculateTodayCards, loadArtwork, PLANNING_CANVAS, renderPlanningCanvas, wrapCanvasText } from '../apps/mobile/planning-export.js';

function canvasHarness() {
  const text: Array<{ value: string; x: number; y: number; width: number }> = [];
  const context: any = {
    font: '16px sans-serif', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: 'left',
    measureText(value: string) { const size = Number(/(\d+)px/.exec(this.font)?.[1] || 16); return { width: [...value].length * size * .54 }; },
    fillText(value: string, x: number, y: number) { const width = this.measureText(value).width; text.push({ value, x: this.textAlign === 'right' ? x - width : x, y, width }); },
    beginPath() {}, roundRect() {}, fill() {}, fillRect() {}, strokeRect() {}, clip() {}, save() {}, restore() {}, drawImage: vi.fn(),
    createLinearGradient() { return { addColorStop() {} }; },
  };
  const canvas: any = { width: 0, height: 0, getContext: () => context };
  return { documentApi: { createElement: () => canvas }, canvas, context, text };
}

const event = (day: number, title: string, category: string, art?: string) => ({
  id: `${day}-${title}`, title, twitchCategoryId: '42', twitchCategoryName: category, twitchBoxArtUrl: art,
  category: 'live', source: 'TWITCH', desiredPublication: { twitch: true },
  startAtUtc: new Date(2026, 8, day, 20).toISOString(), endAtUtc: new Date(2026, 8, day, 22).toISOString(),
});
const filters = { twitch: true, google: true, allDay: true, live: true, personal: true, production: true };

describe('layout graphique du planning', () => {
  it('mesure et enveloppe les noms longs sur deux lignes sans dépasser leur largeur', () => {
    const { context } = canvasHarness(); context.font = '24px sans-serif';
    for (const name of ['EA SPORTS FC 26', 'The Elder Scrolls V: Skyrim Special Edition', "Tom Clancy's Rainbow Six Siege", 'NieR Replicant ver.1.22474487139...']) {
      const lines = wrapCanvasText(context, name, 240, 2);
      expect(lines.length).toBeLessThanOrEqual(2);
      expect(lines.every(line => context.measureText(line).width <= 240)).toBe(true);
    }
  });

  it('garde cinq cartes quotidiennes dans le canvas, sans collision', () => {
    const cards = calculateTodayCards(5);
    expect(cards).toHaveLength(5);
    cards.forEach((card, index) => {
      expect(card.x + card.width).toBeLessThanOrEqual(PLANNING_CANVAS.width);
      expect(card.y + card.height).toBeLessThanOrEqual(1240);
      if (index) expect(card.y).toBeGreaterThan(cards[index - 1].y + cards[index - 1].height);
    });
  });

  it('rend aujourd’hui avec titres longs, miniature et fallback dans leurs zones', async () => {
    const harness = canvasHarness();
    const items = [
      event(13, 'Une aventure incroyablement longue avec beaucoup de rebondissements et une communauté formidable', 'The Elder Scrolls V: Skyrim Special Edition', 'https://art/{width}x{height}.jpg'),
      event(13, 'Classé avec les viewers', "Tom Clancy's Rainbow Six Siege"),
    ];
    const image = { naturalWidth: 285, naturalHeight: 380 };
    const result = await renderPlanningCanvas(items, 'Rastaaslan', { period: 'today', filters, now: new Date(2026, 8, 13, 12), documentApi: harness.documentApi, loadArtwork: vi.fn().mockResolvedValueOnce(image).mockResolvedValueOnce(null) });
    expect(result.canvas).toMatchObject({ width: 1080, height: 1350 }); expect(result.count).toBe(2);
    expect(harness.context.drawImage).toHaveBeenCalledOnce();
    expect(harness.text.every(line => line.x >= 0 && line.x + line.width <= 1080 && line.y >= 0 && line.y <= 1350)).toBe(true);
  });

  it('rend les sept jours et distingue deux lives le même jour sans réseau', async () => {
    const harness = canvasHarness();
    const items = Array.from({ length: 7 }, (_, index) => event(14 + index, `Live ${index}`, index ? 'EA SPORTS FC 26' : 'NieR Replicant ver.1.22474487139...'));
    items.push(event(14, 'Deuxième rendez-vous au titre volontairement très long', 'The Elder Scrolls V: Skyrim Special Edition'));
    const result = await renderPlanningCanvas(items, 'Rastaaslan', { period: 'next-week', filters, now: new Date(2026, 8, 7), documentApi: harness.documentApi, loadArtwork: vi.fn().mockResolvedValue(null) });
    expect(result.count).toBe(8); expect(harness.context.drawImage).not.toHaveBeenCalled();
    expect(harness.text.filter(line => line.value.startsWith('Live '))).toHaveLength(7);
    expect(harness.text.some(line => line.value.startsWith('Deuxième rendez-vous'))).toBe(true);
    expect(harness.text.every(line => line.x >= 0 && line.x + line.width <= 1080 && line.y <= 1350)).toBe(true);
  });
});

describe('chargement sûr des miniatures', () => {
  it('charge une box art officielle via blob et remplace les dimensions Twitch', async () => {
    const image: any = {};
    Object.defineProperty(image, 'src', { set() { queueMicrotask(() => image.onload()); } });
    const fetchApi = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['art']) });
    const promise = loadArtwork('https://static-cdn.jtvnw.net/{width}x{height}.jpg', { fetchApi, imageFactory: () => image, urlApi: { createObjectURL: () => 'blob:art', revokeObjectURL: vi.fn() } });
    expect(await promise).toBe(image); expect(fetchApi).toHaveBeenCalledWith(expect.stringContaining('285x380'), expect.any(Object));
  });

  it('retourne silencieusement le fallback en cas d’échec image ou réseau', async () => {
    expect(await loadArtwork('https://invalid/art.jpg', { fetchApi: vi.fn().mockRejectedValue(new Error('offline')) })).toBeNull();
    const broken: any = {};
    Object.defineProperty(broken, 'src', { set() { queueMicrotask(() => broken.onerror()); } });
    expect(await loadArtwork('https://invalid/art.jpg', { fetchApi: vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() }), imageFactory: () => broken, urlApi: { createObjectURL: () => 'blob:broken', revokeObjectURL() {} } })).toBeNull();
  });
});
