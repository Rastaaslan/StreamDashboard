import { describe, expect, it, vi } from 'vitest';
import { calculateTodayCards, calculateWeeklyCards, loadArtwork, PLANNING_CANVAS, renderPlanningCanvas, wrapCanvasText } from '../apps/mobile/planning-export.js';

function canvasHarness() {
  const text: Array<{ value: string; x: number; y: number; width: number }> = [];
  const fills: Array<{ x: number; y: number; width: number; height: number; style: unknown }> = [];
  const context: any = {
    font: '16px sans-serif', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: 'left',
    measureText(value: string) { const size = Number(/(\d+)px/.exec(this.font)?.[1] || 16); return { width: [...value].length * size * .54 }; },
    fillText(value: string, x: number, y: number) { const width = this.measureText(value).width; text.push({ value, x: this.textAlign === 'right' ? x - width : x, y, width }); },
    beginPath() {}, roundRect: vi.fn(), fill() {},
    fillRect(x: number, y: number, width: number, height: number) { fills.push({ x, y, width, height, style: this.fillStyle }); },
    strokeRect() {}, clip() {}, save() {}, restore() {}, drawImage: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
  const canvas: any = { width: 0, height: 0, getContext: () => context };
  return { documentApi: { createElement: () => canvas }, canvas, context, text, fills };
}

function expectFullBackground(harness: ReturnType<typeof canvasHarness>) {
  const { canvas, context, fills } = harness;
  expect(context.createLinearGradient.mock.calls[0]).toEqual([0, 0, canvas.width, canvas.height]);
  const gradient = context.createLinearGradient.mock.results[0].value;
  expect(gradient.addColorStop.mock.calls).toEqual([[0, '#090914'], [.62, '#18112c'], [1, '#321827']]);
  expect(fills[0]).toEqual({ x: 0, y: 0, width: canvas.width, height: canvas.height, style: gradient });
}

function expectVisibleCards(harness: ReturnType<typeof canvasHarness>, count: number) {
  const cards = harness.context.roundRect.mock.calls.filter(([, , width]: number[]) => width === 960);
  expect(cards).toHaveLength(count);
  cards.forEach(([x, y, width, height]: number[], index: number) => {
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(harness.canvas.width);
    expect(y).toBeGreaterThanOrEqual(210);
    expect(y + height).toBeLessThanOrEqual(harness.canvas.height - 90);
    if (index) expect(y).toBeGreaterThan(cards[index - 1][1] + cards[index - 1][3]);
  });
  expect(harness.text.every(line => line.x >= 0 && line.x + line.width <= harness.canvas.width && line.y > 0 && line.y <= harness.canvas.height - 24)).toBe(true);
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

  it('utilise toute la largeur et des miniatures visibles dans les cartes semaine', () => {
    const single = calculateWeeklyCards(1, 216);
    const pair = calculateWeeklyCards(2, 216);
    expect(single[0]).toMatchObject({ x: 60, width: 960, height: 94 });
    expect(pair).toHaveLength(2);
    expect(pair.every(card => card.x === 60 && card.width === 960)).toBe(true);
    expect(pair[1].y).toBeGreaterThan(pair[0].y + pair[0].height);
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
    expectFullBackground(harness);
    expect(harness.context.drawImage).toHaveBeenCalledOnce();
    expect(harness.text.every(line => line.x >= 0 && line.x + line.width <= 1080 && line.y >= 0 && line.y <= result.canvas.height)).toBe(true);
  });

  it('rend les sept jours et distingue deux lives le même jour sans réseau', async () => {
    const harness = canvasHarness();
    const items = Array.from({ length: 7 }, (_, index) => event(14 + index, `Live ${index}`, index ? 'EA SPORTS FC 26' : 'NieR Replicant ver.1.22474487139...'));
    items.push(event(14, 'Deuxième rendez-vous au titre volontairement très long', 'The Elder Scrolls V: Skyrim Special Edition'));
    const result = await renderPlanningCanvas(items, 'Rastaaslan', { period: 'next-week', filters, now: new Date(2026, 8, 7), documentApi: harness.documentApi, loadArtwork: vi.fn().mockResolvedValue(null) });
    expect(result.count).toBe(8); expect(harness.context.drawImage).not.toHaveBeenCalled();
    expect(harness.text.filter(line => line.value.startsWith('Live '))).toHaveLength(7);
    expect(harness.text.some(line => line.value.startsWith('Deuxième rendez-vous'))).toBe(true);
    expect(harness.text.filter(line => line.x < 0 || line.x + line.width > result.canvas.width || line.y > result.canvas.height)).toEqual([]);
  });

  it('exporte tous les événements d’une journée chargée sans troncature', async () => {
    const harness = canvasHarness();
    const items = Array.from({ length: 5 }, (_, index) => ({
      ...event(14, `Live chargé ${index + 1}`, 'Just Chatting'),
      startAtUtc: new Date(2026, 8, 14, 16 + index).toISOString(),
      endAtUtc: new Date(2026, 8, 14, 17 + index).toISOString(),
    }));
    const result = await renderPlanningCanvas(items, 'Rastaaslan', { period: 'next-week', filters, now: new Date(2026, 8, 7), documentApi: harness.documentApi, loadArtwork: vi.fn().mockResolvedValue(null) });
    expect(result.count).toBe(5);
    for (let index = 1; index <= 5; index++) expect(harness.text.some(line => line.value === `Live chargé ${index}`)).toBe(true);
    expect(result.canvas.height).toBeGreaterThanOrEqual(PLANNING_CANVAS.height);
    expect(harness.text.every(line => line.y <= result.canvas.height)).toBe(true);
  });

  it('dessine une miniature semaine nettement visible', async () => {
    const harness = canvasHarness();
    const image = { naturalWidth: 285, naturalHeight: 380 };
    await renderPlanningCanvas([event(14, 'Une soirée aventure', 'The Elder Scrolls V: Skyrim Special Edition', 'https://art/{width}x{height}.jpg')], 'Rastaaslan', { period: 'next-week', filters, now: new Date(2026, 8, 7), documentApi: harness.documentApi, loadArtwork: vi.fn().mockResolvedValue(image) });
    const [, , , drawWidth, drawHeight] = harness.context.drawImage.mock.calls[0];
    expect(drawWidth).toBeGreaterThanOrEqual(82);
    expect(drawHeight).toBeGreaterThanOrEqual(88);
  });

  it.each(['today', 'this-week', 'next-week'])('couvre toute la hauteur dynamique et garde toutes les cartes : %s', async period => {
    const harness = canvasHarness();
    const items = Array.from({ length: 12 }, (_, index) => event(14, `Rendez-vous ${index + 1}`, 'Just Chatting'));
    // Include the last day as well as a busy first day to catch clipping of later rows.
    if (period !== 'today') items.push(event(20, 'Dernier rendez-vous', 'Just Chatting'));
    const result = await renderPlanningCanvas(items, 'Rastaaslan', {
      period, filters, now: new Date(2026, 8, period === 'next-week' ? 7 : 14, 12),
      documentApi: harness.documentApi, loadArtwork: vi.fn().mockResolvedValue(null),
      noteEnabled: true, noteText: 'À bientôt !',
    });
    expect(result.canvas.height).toBeGreaterThan(1350);
    expect(result.count).toBe(items.length);
    expectFullBackground(harness);
    expectVisibleCards(harness, items.length);
    for (const item of items) expect(harness.text.filter(line => line.value === item.title)).toHaveLength(1);
    expect(harness.text.some(line => line.value === 'À bientôt !')).toBe(true);
    expect(harness.text.at(-1)?.value).toBe('Planning prévisionnel · StreamDashboard');
  });

  it.each(['today', 'this-week', 'next-week'])('conserve les copies distinctes et les occurrences daily : %s', async period => {
    const harness = canvasHarness();
    const original = {
      ...event(14, 'Live quotidien', 'Just Chatting'),
      recurrence: { frequency: 'daily', interval: 1, timeZone: 'Europe/Paris', until: null, exceptions: {} },
    };
    const copy = { ...structuredClone(original), id: 'copie', desiredPublication: { local: true, twitch: false } };
    const items = [original, copy];
    const before = structuredClone(items);
    const expectedCount = period === 'today' ? 2 : 14;
    const result = await renderPlanningCanvas(items, 'Rastaaslan', {
      period, filters, now: new Date(2026, 8, period === 'next-week' ? 7 : 16, 12),
      documentApi: harness.documentApi, loadArtwork: vi.fn().mockResolvedValue(null),
    });
    expect(result.count).toBe(expectedCount);
    expect(harness.text.filter(line => line.value === original.title)).toHaveLength(expectedCount);
    expectFullBackground(harness);
    expectVisibleCards(harness, expectedCount);
    expect(items).toEqual(before);
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
