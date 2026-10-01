import { describe, expect, it } from 'vitest';
import { normalizeCategoryQuery, rankCategories, rememberCategory } from '../apps/mobile/twitch-category.js';

describe('sélecteur catégorie Twitch', () => {
  it('normalise accents, casse et espaces', () => expect(normalizeCategoryQuery('  ÉA   SpÖ  ')).toBe('ea spo'));
  it('priorise exact, récent, préfixe puis résultats Twitch et conserve id + nom', () => {
    const recent = [{ id: '2', name: 'Football Manager' }];
    const ranked = rankCategories([{ id: '3', name: 'Other FC' }, { id: '1', name: 'FC' }, { id: '4', name: 'FC 26' }], recent, 'fc');
    expect(ranked.map(item => item.id)).toEqual(['1', '2', '4', '3']);
    expect(ranked[0]).toEqual({ id: '1', name: 'FC' });
  });
  it('mémorise au plus huit catégories uniques', () => {
    let recent: Array<{id:string;name:string}>=[]; for(let i=0;i<10;i++)recent=rememberCategory(recent,{id:String(i),name:`Game ${i}`});
    expect(recent).toHaveLength(8); expect(rememberCategory(recent,{id:'5',name:'Game 5'})[0].id).toBe('5');
  });
});
