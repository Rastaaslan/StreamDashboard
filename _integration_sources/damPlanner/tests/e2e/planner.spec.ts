import { expect, test, type Locator, type Page } from '@playwright/test';

async function mockPreload(page: Page) {
  await page.addInitScript(() => {
    const rows: any[] = [], routines: any[] = [], templates: any[] = [];
    (window as any).damplanner = {
      list: async () => [...rows],
      hub: async () => ({
        rows: [...rows], warnings: [], fetchedAt: Date.now(), fromCache: false,
        items: rows.map(row => ({
          id: `local:${row.event.id}`, source: 'DAMPLANNER', ownership: 'LOCAL', title: row.event.title,
          description: row.event.description, startAtUtc: row.event.startAtUtc, endAtUtc: row.event.endAtUtc,
          allDay: false, editable: true, localEventId: row.event.id, kind: row.event.kind,
          draft: row.event.status === 'DRAFT', lifecycleState: row.event.lifecycleState, actualStartAt: row.event.actualStartAt, actualEndAt: row.event.actualEndAt, google: row.google, twitch: row.twitch,
          metadata: { conflictAccepted: row.event.conflictOverrideHash ? 'true' : undefined, checklist: '0/0' },
        })),
      }),
      settings: async () => ({
        timezone: 'Europe/Paris', googleDefaultCalendarId: 'primary', googleAvailabilityCalendarIds: ['primary'],
        twitchClientId: 'test', availabilityLocal: true, availabilityGoogle: false, availabilityTwitch: false,
        onboardingDone: true, googleConfigured: true, googleConnected: true, twitchConfigured: true, twitchConnected: true,
      }),
      preview: async (input: any, id?: string) => {
        const conflict = rows.find(x => x.event.id !== id && x.event.startAtUtc < input.endAtUtc && x.event.endAtUtc > input.startAtUtc);
        return { event: input, availability: { status: conflict ? 'CONFLICT' : 'AVAILABLE', hash: 'accepted', errors: [], conflicts: conflict ? [{ ...conflict.event, source: 'LOCAL' }] : [] } };
      },
      save: async (input: any, id?: string, hash?: string) => {
        const event = { ...input, id: id ?? crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null, conflictOverrideHash: hash ?? null, conflictOverrideAt: hash ? new Date().toISOString() : null };
        const index = rows.findIndex(x => x.event.id === id);
        const row = { event, google: input.syncGoogle ? { status: 'SYNCED' } : undefined, twitch: input.syncTwitch ? { status: 'SYNCED' } : undefined };
        if (index < 0) rows.push(row); else rows[index] = row;
        return event;
      },
      remove: async (id: string) => { const index = rows.findIndex(x => x.event.id === id); if (index >= 0) rows.splice(index, 1); },
      retry: async () => {}, publish: async () => ({}), adopt: async () => {}, duplicate: async () => {},
      templates: async () => [...templates], saveTemplate: async (value: any) => { const index = templates.findIndex(x => x.id === value.id); if (index < 0) templates.push(value); else templates[index] = value; }, deleteTemplate: async (id: string) => { const index = templates.findIndex(x => x.id === id); if (index >= 0) templates.splice(index, 1); }, testConnections: async () => ({ google: { connected: true, calendars: 1 }, twitch: { connected: true, schedule: true } }),
      cockpitData: async () => ({ routines: [...routines], participants: [], tags: [], targets: [] }),
      saveRoutine: async (value: any) => { const index = routines.findIndex(x => x.id === value.id); if (index < 0) routines.push(value); else routines[index] = value; }, deleteRoutine: async (id: string) => { const index = routines.findIndex(x => x.id === id); if (index >= 0) routines.splice(index, 1); }, attachRoutine: async () => {}, checkRoutine: async () => {}, resetRoutine: async () => {},
      savePostLive: async () => {}, saveParticipant: async () => {}, saveTag: async () => {}, saveNetworkAction: async () => {}, createLocalAction: async () => null, executeAction: async () => {},
      setLifecycle: async (id: string, state: string) => {
        const row = rows.find(x => x.event.id === id);
        if (row) row.event = { ...row.event, lifecycleState: state, actualStartAt: state === 'LIVE' && !row.event.actualStartAt ? new Date().toISOString() : row.event.actualStartAt };
        return row?.event;
      },
      completeLive: async (id: string, actualEndAt: string, mood: string | null, note: string) => { const row = rows.find(x => x.event.id === id); if (row) row.event = { ...row.event, lifecycleState: 'FINISHED', actualEndAt, postLiveMood: mood, postLiveNote: note }; return row?.event; },
      categories: async () => [{ id: '1', name: 'Just Chatting', boxArtUrl: '' }], updateSettings: async () => {},
      importGoogle: async () => true, connectGoogle: async () => {}, disconnectGoogle: async () => {}, calendars: async () => [],
      beginTwitch: async () => ({}), completeTwitch: async () => {}, disconnectTwitch: async () => {}, openExternal: async () => {},
    };
  });
}

async function fill(page: Page, title: string, kind = 'LIVE') {
  await page.getByRole('button', { name: '+ Nouvel événement' }).click();
  await page.getByLabel('Type').selectOption(kind);
  await page.getByLabel('Titre', { exact: true }).fill(title);
  await page.getByLabel('Date').fill('2026-09-03');
  await page.getByLabel('Début').fill('20:00');
  await page.getByLabel('Fin').fill('22:00');
}

async function previewAndSave(page: Page) {
  await page.getByRole('button', { name: 'Prévisualiser et vérifier' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Événement prêt à enregistrer' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
}

function eventCard(page: Page, title: string): Locator {
  return page.locator('article.event').filter({ has: page.getByText(title, { exact: true }) });
}

test.beforeEach(async ({ page }) => { await mockPreload(page); await page.goto('/'); });

test('création LIVE Google+Twitch, modification et suppression', async ({ page }) => {
  await fill(page, 'Soirée Twitch');
  await page.getByLabel('Google Calendar').check();
  await page.getByLabel('Twitch', { exact: true }).check();
  await page.getByLabel('Titre public Twitch').fill('Live public');
  await page.getByLabel('Catégorie Twitch').fill('Just');
  await page.getByRole('button', { name: 'Just Chatting' }).click();
  await previewAndSave(page);

  let card = eventCard(page, 'Soirée Twitch');
  await expect(card).toBeVisible();
  await expect(card.getByText('✓ Google')).toBeVisible();
  await expect(card.getByText('✓ Twitch')).toBeVisible();
  await card.getByRole('button', { name: 'Modifier' }).click();
  await page.getByLabel('Titre', { exact: true }).fill('Soirée modifiée');
  await previewAndSave(page);

  card = eventCard(page, 'Soirée modifiée');
  await expect(card).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await card.getByRole('button', { name: 'Supprimer' }).click();
  await expect(card).toHaveCount(0);
});

test('PERSONAL Google only', async ({ page }) => {
  await fill(page, 'Rendez-vous', 'PERSONAL');
  await page.getByLabel('Google Calendar').check();
  await expect(page.getByLabel('Twitch', { exact: true })).not.toBeChecked();
  await previewAndSave(page);

  const card = eventCard(page, 'Rendez-vous');
  await expect(card).toBeVisible();
  await expect(card.getByText('✓ Google')).toBeVisible();
});

test('deux événements simultanés sont conservés après confirmation', async ({ page }) => {
  await fill(page, 'Premier');
  await previewAndSave(page);
  await expect(eventCard(page, 'Premier')).toBeVisible();

  await fill(page, 'Second');
  await page.getByRole('button', { name: 'Prévisualiser et vérifier' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Chevauchement détecté' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Valider quand même' }).click();

  await expect(eventCard(page, 'Premier')).toBeVisible();
  const second = eventCard(page, 'Second');
  await expect(second).toBeVisible();
  await expect(second.getByText('Chevauchement accepté')).toBeVisible();
});

test('navigation Agenda et Aujourd’hui reste disponible', async ({ page }) => {
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Semaine' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mois' })).toBeVisible();
  await page.getByRole('button', { name: 'Aujourd’hui', exact: true }).first().click();
  await expect(page.getByText('PROCHAIN ÉVÉNEMENT')).toBeVisible();
});

test('ouvre le Live Cockpit et change le lifecycle', async ({ page }) => {
  await fill(page, 'Cockpit LIVE');
  await previewAndSave(page);
  const card = eventCard(page, 'Cockpit LIVE');
  await card.getByRole('button', { name: 'Préparer le live' }).click();
  await expect(page.getByText('LIVE COCKPIT')).toBeVisible();
  await expect(page.getByText(/EN PRÉPARATION/)).toBeVisible();
  await page.getByRole('button', { name: 'Marquer prêt' }).click();
  await expect(page.getByText(/PRÊT/)).toBeVisible();
});


test('clôture explicite avec humeur et note', async ({ page }) => {
  await fill(page, 'Live à clôturer');
  await previewAndSave(page);
  await eventCard(page, 'Live à clôturer').getByRole('button', { name: 'Préparer le live' }).click();
  await page.getByRole('button', { name: 'Marquer prêt' }).click();
  await page.getByRole('button', { name: 'Je suis en live' }).click();
  await expect(page.getByText(/EN LIVE/)).toBeVisible();
  await page.getByRole('button', { name: 'Terminer le live' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('TERMINER LE LIVE')).toBeVisible();
  await dialog.getByRole('button', { name: 'Humeur FIRE' }).click();
  await dialog.getByLabel('Notes').fill('Super live');
  await dialog.getByRole('button', { name: 'Valider et clôturer le live' }).click();
  await expect(eventCard(page, 'Live à clôturer').getByText(/TERMINÉ/)).toBeVisible();
  await page.getByRole('button', { name: 'Terminés' }).click();
  await expect(eventCard(page, 'Live à clôturer')).toBeVisible();
});

test('CRUD routine avec étapes et réordonnement accessible', async ({ page }) => {
  await page.getByRole('button', { name: 'Réglages' }).click();
  await page.getByRole('button', { name: '+ Nouvelle routine' }).click();
  await page.getByLabel('Nom de la routine').fill('Routine FC26');
  const before = page.locator('.phase-editor').first();
  await before.getByRole('button', { name: '+ Ajouter une étape' }).click();
  await before.getByRole('button', { name: '+ Ajouter une étape' }).click();
  const labels = before.locator('.step-editor input');
  await labels.nth(0).fill('Micro');
  await labels.nth(1).fill('Boisson');
  await before.getByRole('button', { name: 'Monter' }).nth(1).click();
  await page.getByRole('button', { name: 'Enregistrer la routine' }).click();
  await expect(page.getByText('Routine FC26', { exact: true })).toBeVisible();
  await page.locator('.manager-row').filter({ hasText: 'Routine FC26' }).getByRole('button', { name: 'Modifier' }).click();
  await expect(page.locator('.step-editor input').nth(0)).toHaveValue('Boisson');
  await page.getByRole('button', { name: 'Annuler' }).click();
  await page.locator('.manager-row').filter({ hasText: 'Routine FC26' }).getByRole('button', { name: 'Dupliquer' }).click();
  await expect(page.getByText('Routine FC26 — copie', { exact: true })).toBeVisible();
});

test('CRUD modèle enrichi et duplication', async ({ page }) => {
  await page.getByRole('button', { name: 'Réglages' }).click();
  await page.getByRole('button', { name: '+ Nouveau modèle' }).click();
  const editor = page.locator('.manager-editor');
  await editor.getByLabel('Nom', { exact: true }).fill('FC26 Club Pro');
  await editor.getByLabel('Durée (minutes)').fill('180');
  await editor.getByLabel('Publier sur Google par défaut').check();
  await editor.getByLabel('Publier sur Twitch par défaut').check();
  await editor.getByLabel('Titre Twitch').fill('{game} avec {participants}');
  await editor.getByLabel('Catégorie Twitch').fill('Just');
  await page.getByRole('button', { name: 'Just Chatting' }).click();
  await editor.getByRole('button', { name: 'Enregistrer le modèle' }).click();
  await expect(page.getByText('FC26 Club Pro', { exact: true })).toBeVisible();
  const row = page.locator('.manager-row').filter({ hasText: 'FC26 Club Pro' });
  await row.getByRole('button', { name: 'Modifier' }).click();
  await page.getByLabel('Durée (minutes)').fill('240');
  await page.getByRole('button', { name: 'Enregistrer le modèle' }).click();
  await expect(page.locator('.manager-row').filter({ hasText: 'FC26 Club Pro' })).toContainText('240 min');
  await page.locator('.manager-row').filter({ hasText: 'FC26 Club Pro' }).getByRole('button', { name: 'Dupliquer' }).click();
  await expect(page.getByText('FC26 Club Pro — copie', { exact: true })).toBeVisible();
});
