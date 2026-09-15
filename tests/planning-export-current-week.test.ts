import { describe, expect, it, vi } from 'vitest';
import { planningFileName, renderPlanningCanvas } from '../apps/mobile/planning-export.js';

function harness() {
  const text: string[] = [];
  const context: any = {
    font: '16px sans-serif', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: 'left',
    measureText(value: string) { const size = Number(/(\d+)px/.exec(this.font)?.[1] || 16); return { width: [...value].length * size * .54 }; },
    fillText(value: string) { text.push(value); },
    beginPath() {}, roundRect() {}, fill() {}, fillRect() {}, strokeRect() {}, clip() {}, save() {}, restore() {}, drawImage: vi.fn(),
    createLinearGradient() { return { addColorStop() {} }; },
  };
  const canvas: any = { width: 0, height: 0, getContext: () => context };
  return { documentApi: { createElement: () => canvas }, context, text };
}

const filters = { twitch: true, google: true, allDay: true, live: true, personal: true, production: true };
const event = (day: number, title: string) => ({
  id: title,
  title,
  category: 'live',
  source: 'TWITCH',
  desiredPublication: { twitch: true },
  twitchCategoryId: '509658',
  twitchCategoryName: 'Just Chatting',
  startAtUtc: new Date(2026, 8, day, 20).toISOString(),
  endAtUtc: new Date(2026, 8, day, 22).toISOString(),
});

describe('export planning cette semaine', () => {
  it('exporte la semaine courante après le passage de minuit, sans basculer sur la suivante', async () => {
    const current = harness();
    const loadArtwork = vi.fn().mockResolvedValue({ naturalWidth: 285, naturalHeight: 380 });
    const result = await renderPlanningCanvas(
      [event(14, 'Live cette semaine'), event(21, 'Live semaine prochaine')],
      'Rastaaslan',
      { period: 'this-week', filters, now: new Date(2026, 8, 14, 0, 6), documentApi: current.documentApi, loadArtwork },
    );
    expect(result.count).toBe(1);
    expect(current.text).toContain('Live cette semaine');
    expect(current.text).not.toContain('Live semaine prochaine');
    expect(loadArtwork).toHaveBeenCalledWith(expect.stringContaining('/509658-{width}x{height}.jpg'), undefined);
    expect(current.context.drawImage).toHaveBeenCalledOnce();
  });

  it('conserve aussi la période semaine prochaine séparément', async () => {
    const next = harness();
    const result = await renderPlanningCanvas(
      [event(14, 'Live cette semaine'), event(21, 'Live semaine prochaine')],
      'Rastaaslan',
      { period: 'next-week', filters, now: new Date(2026, 8, 14, 0, 6), documentApi: next.documentApi, loadArtwork: vi.fn().mockResolvedValue(null) },
    );
    expect(result.count).toBe(1);
    expect(next.text).toContain('Live semaine prochaine');
    expect(next.text).not.toContain('Live cette semaine');
  });

  it('nomme distinctement le fichier de la semaine courante', () => {
    expect(planningFileName('this-week')).toBe('planning-cette-semaine.png');
    expect(planningFileName('next-week')).toBe('planning-semaine.png');
  });
});
