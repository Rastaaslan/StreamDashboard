import { afterEach, describe, expect, it, vi } from 'vitest';
import { planningFileName, sharePlanningPng } from '../apps/mobile/planning-export.js';

const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

describe('partage du PNG Planning', () => {
  afterEach(() => vi.restoreAllMocks());

  it('utilise exclusivement le bridge Android lorsqu’il est disponible', async () => {
    const shareImage = vi.fn(() => '');
    const webShare = vi.fn();
    expect(await sharePlanningPng(png(), 'planning-aujourdhui.png', { shareImage }, { share: webShare, canShare: () => true })).toBe('android');
    expect(shareImage).toHaveBeenCalledWith(expect.any(String), 'planning-aujourdhui.png', 'image/png');
    expect(webShare).not.toHaveBeenCalled();
  });

  it('propage une erreur du bridge natif', async () => {
    await expect(sharePlanningPng(png(), 'planning-semaine.png', { shareImage: () => 'Impossible d’ouvrir le partage Android.' })).rejects.toThrow('Impossible d’ouvrir le partage Android.');
  });

  it('utilise Web Share dans un navigateur compatible', async () => {
    const share = vi.fn();
    expect(await sharePlanningPng(png(), 'planning-aujourdhui.png', undefined, { share, canShare: () => true })).toBe('web-share');
    expect(share).toHaveBeenCalledOnce();
  });

  it('télécharge le PNG lorsque Web Share est indisponible', async () => {
    const click = vi.fn();
    const urlApi = { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() };
    const documentApi = { createElement: vi.fn(() => ({ click })) };
    expect(await sharePlanningPng(png(), 'planning-semaine.png', undefined, {}, documentApi, urlApi)).toBe('download');
    expect(click).toHaveBeenCalledOnce();
  });

  it('utilise les noms stables selon la période', () => {
    expect(planningFileName('today')).toBe('planning-aujourdhui.png');
    expect(planningFileName('next-week')).toBe('planning-semaine.png');
  });
});
