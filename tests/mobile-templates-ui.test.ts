import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCompanionStore } from '../apps/mobile/companion-store.js';

const index = readFileSync(new URL('../apps/mobile/index.html', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../apps/mobile/mobile.js', import.meta.url), 'utf8');
const templatesUi = readFileSync(new URL('../apps/mobile/features/templates.js', import.meta.url), 'utf8');

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('templates de live mobile', () => {
  beforeEach(() => vi.stubGlobal('crypto', { randomUUID: () => 'uuid' }));

  it('expose un vrai éditeur de template dans la prépa mobile', () => {
    for (const id of ['template-dialog', 'template-name', 'template-description', 'template-twitch-category', 'template-twitch-game-id', 'template-publish-twitch', 'template-publish-google']) {
      expect(index).toContain(`id="${id}"`);
    }
    expect(index).not.toContain('src="templates-ui.js"');
    expect(mobile).toContain("import('./features/templates.js')");
  });

  it('permet créer, modifier, supprimer et appliquer un template au planning', () => {
    expect(templatesUi).toContain("companion.upsertCollection('templates'");
    expect(templatesUi).toContain("companion.removeCollection('templates'");
    expect(templatesUi).toContain('openTemplateDialog(template)');
    expect(templatesUi).toContain('applyTemplate(template)');
    expect(templatesUi).toContain("form.elements.namedItem('title').value = template.title");
    expect(templatesUi).toContain("$('slot-twitch-game-id').value = template.twitchCategoryId");
    expect(templatesUi).toContain("document.querySelector('[data-tab=\"planning\"]')?.click()");
  });

  it('réutilise le sélecteur Twitch officiel et conserve ID + nom', () => {
    expect(templatesUi).toContain('normalizeCategoryQuery(input.value)');
    expect(templatesUi).toContain('rankCategories(found, recentCategories, query)');
    expect(templatesUi).toContain('rememberCategory(recentCategories');
    expect(templatesUi).toContain("twitchCategoryId: twitch ? $('template-twitch-game-id').value : ''");
    expect(templatesUi).toContain("twitchCategoryName: twitch ? $('template-twitch-category').value.trim() : ''");
  });

  it('génère un patch de collection accepté par le serveur', () => {
    const storage = new MemoryStorage();
    const store = createCompanionStore(storage as unknown as Storage, () => '2026-09-13T17:30:00.000Z');
    store.upsertCollection('templates', {
      title: 'FC26',
      description: 'Clubs chill',
      twitchCategoryId: '1743359147',
      twitchCategoryName: 'EA SPORTS FC 26',
      desiredPublication: { twitch: true, google: true, local: false },
    });
    const operation = store.snapshot().pending.at(-1);
    expect(operation).toMatchObject({ type: 'templates.upsert', baseRevision: 0, patch: { title: 'FC26', twitchCategoryId: '1743359147' } });
    expect(operation.patch).not.toHaveProperty('id');
    expect(operation.patch).not.toHaveProperty('revision');
    expect(operation.patch).not.toHaveProperty('updatedAt');
  });

  it('supprime une collection synchronisée avec sa révision courante', () => {
    const storage = new MemoryStorage();
    const store = createCompanionStore(storage as unknown as Storage, () => '2026-09-13T17:30:00.000Z');
    store.replaceServerSnapshot({
      planning: [],
      templates: [{ id: 'template-fc26', title: 'FC26', revision: 4, updatedAt: '2026-09-13T17:00:00.000Z' }],
      settings: {},
    });
    expect(store.removeCollection('templates', 'template-fc26')).toEqual({ deleted: true });
    expect(store.snapshot().pending.at(-1)).toMatchObject({ type: 'templates.delete', eventId: 'template-fc26', baseRevision: 4 });
  });
});
