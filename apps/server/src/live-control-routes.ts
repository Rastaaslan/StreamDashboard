import type express from 'express';
import { randomUUID } from 'node:crypto';
import type { ActionCommand, Sound } from '../../../packages/contracts/src/index.js';
import type { Automation } from '../../../packages/core/src/live-control-domains.js';
import type { EventCore } from '../../../packages/core/src/events.js';
import type { StreamlabsAdapter } from '../../../integrations/streamlabs/src/adapter.js';
import type { WizeBotAdapter } from '../../../integrations/wizebot/src/adapter.js';
import type { SecretStore } from './storage.js';
import type { ObsSoundboardSetupStatus } from './obs-soundboard.js';
import { validateSound, type SoundboardRuntime } from './soundboard-runtime.js';
import type { AutomationRuntime } from './automation-runtime.js';
import type { SupportRuntime } from './support-runtime.js';

interface Options {
  app: express.Application; soundboard: SoundboardRuntime; automation: AutomationRuntime; support: SupportRuntime; streamlabs: StreamlabsAdapter; wizebot: WizeBotAdapter; eventCore: EventCore; secrets: SecretStore;
  requireLocal(req: express.Request, res: express.Response): boolean; isRemote(req: express.Request): boolean; save(): Promise<void>;
  sounds(): Sound[]; setSounds(value: Sound[]): void; sessionStartedAt(): string | null;
  resolveSoundLibraryFile(libraryId: string): Promise<string>; removeSoundLibraryFile(source: string): Promise<void>;
  soundboardObsStatus(): Promise<ObsSoundboardSetupStatus>; setupSoundboardObs(): Promise<ObsSoundboardSetupStatus>;
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const AUTOMATION_TRIGGERS = ['support.received', 'test.support', 'twitch.reward.redeemed', 'streamer.ping.received', 'stream.started', 'stream.stopped', 'obs.state.changed', 'chat.message.received'] as const;
const AUTOMATION_ACTIONS = ['soundboard.play', 'obs.scene', 'obs.media.restart', 'timer.add', 'timer.start', 'timer.pause'] as const;

export function registerLiveControlRoutes(options: Options) {
  const { app, soundboard, automation, support, streamlabs, wizebot, eventCore } = options;
  app.get('/api/v1/events', (req, res) => { const string = (value: unknown, max: number) => typeof value === 'string' && value.length <= max ? value : undefined; res.json({ items: eventCore.recent({ type: string(req.query.type, 120), source: string(req.query.source, 80), correlationId: string(req.query.correlationId, 128), limit: Number(req.query.limit) || 100 }) }); });
  app.get('/api/v1/soundboard', async (_req, res, next) => { try { res.json(await soundboard.snapshot()); } catch (error) { next(error); } });
  app.get('/api/v1/soundboard/obs/status', async (req, res, next) => { try { if (!options.requireLocal(req, res)) return; res.json(await options.soundboardObsStatus()); } catch (error) { next(error); } });
  app.post('/api/v1/soundboard/obs/setup', async (req, res, next) => { try { if (!options.requireLocal(req, res)) return; res.json(await options.setupSoundboardObs()); } catch (error) { next(error); } });
  app.put('/api/v1/soundboard/catalog', async (req, res, next) => { try { if (!options.requireLocal(req, res)) return; if (!Array.isArray(req.body?.sounds) || req.body.sounds.length > 500) throw new Error('Catalogue soundboard invalide.'); const sounds = req.body.sounds.map(validateSound); soundboard.replace(sounds); options.setSounds(sounds); await options.save(); res.json(await soundboard.snapshot()); } catch (error) { next(error); } });
  app.post('/api/v1/soundboard/sounds', async (req, res, next) => {
    try {
      if (!options.requireLocal(req, res)) return;
      if (!object(req.body) || Object.keys(req.body).some(key => !['libraryId','name','favorite','volume','enabled','cooldownMs','category','monitoringMode'].includes(key))) throw new Error('Nouveau son invalide.');
      const source = await options.resolveSoundLibraryFile(String(req.body.libraryId ?? ''));
      const sound = validateSound({
        id: randomUUID(), source, outputId: 'obs', name: String(req.body.name ?? ''), category: String(req.body.category ?? ''),
        favorite: req.body.favorite === true, enabled: req.body.enabled !== false, volume: Number(req.body.volume ?? 1),
        cooldownMs: Number(req.body.cooldownMs ?? 0), monitoringMode: req.body.monitoringMode === 'monitor' ? 'monitor' : 'stream',
      });
      const sounds = [...options.sounds(), sound];
      options.setSounds(sounds); soundboard.replace(sounds); await options.save();
      res.status(201).json(await soundboard.snapshot());
    } catch (error) { next(error); }
  });
  app.put('/api/v1/soundboard/sounds/:id', async (req, res, next) => {
    try {
      const sounds = options.sounds(); const sound = sounds.find(value => value.id === req.params.id);
      if (!sound) { res.status(404).json({ ok: false, error: { code: 'SOUND_NOT_FOUND', message: 'Son introuvable.' } }); return; }
      if (!object(req.body) || Object.keys(req.body).some(key => !['libraryId','name','favorite','volume','enabled','cooldownMs','category','monitoringMode'].includes(key))) throw new Error('Modification soundboard invalide.');
      const previousSource = sound.source;
      const source = req.body.libraryId === undefined ? previousSource : await options.resolveSoundLibraryFile(String(req.body.libraryId));
      const { libraryId: _libraryId, ...patch } = req.body;
      Object.assign(sound, validateSound({ ...sound, ...patch, source, outputId: 'obs' }));
      soundboard.replace(sounds); options.setSounds(sounds); await options.save();
      if (source !== previousSource) await options.removeSoundLibraryFile(previousSource);
      res.json(await soundboard.snapshot());
    } catch (error) { next(error); }
  });
  app.delete('/api/v1/soundboard/sounds/:id', async (req, res, next) => {
    try {
      if (!options.requireLocal(req, res)) return;
      const sounds = options.sounds(); const sound = sounds.find(value => value.id === req.params.id);
      if (!sound) { res.status(404).json({ ok: false, error: { code: 'SOUND_NOT_FOUND', message: 'Son introuvable.' } }); return; }
      await soundboard.stop();
      const nextSounds = sounds.filter(value => value.id !== sound.id);
      options.setSounds(nextSounds); soundboard.replace(nextSounds); await options.save(); await options.removeSoundLibraryFile(sound.source);
      res.status(204).end();
    } catch (error) { next(error); }
  });
  app.post('/api/v1/soundboard/play', async (req, res, next) => { try { const command: ActionCommand<{ soundId: string; volume?: number }> = { commandId: String(req.body?.commandId ?? ''), correlationId: typeof req.body?.correlationId === 'string' ? req.body.correlationId : undefined, type: 'soundboard.play', origin: options.isRemote(req) ? 'android' : 'desktop', issuedAt: typeof req.body?.issuedAt === 'string' ? req.body.issuedAt : new Date().toISOString(), payload: { soundId: String(req.body?.soundId ?? ''), ...(typeof req.body?.volume === 'number' ? { volume: req.body.volume } : {}) } }; eventCore.publish({ type: 'soundboard.play.requested', source: 'runtime', correlationId: command.correlationId, payload: { commandId: command.commandId, soundId: command.payload.soundId } }); const ack = await soundboard.play(command); eventCore.publish({ type: ack.status === 'succeeded' ? 'soundboard.played' : 'soundboard.failed', source: 'runtime', correlationId: ack.correlationId, payload: ack }); res.status(ack.status === 'succeeded' ? 200 : 409).json(ack); } catch (error) { next(error); } });
  app.post('/api/v1/soundboard/stop', async (_req, res, next) => { try { await soundboard.stop(); res.status(204).end(); } catch (error) { next(error); } });

  app.get('/api/v1/automations', (_req, res) => res.json({ items: automation.list(), executions: automation.recent() }));
  app.get('/api/v1/automations/capabilities', (_req, res) => res.json({
    triggers: AUTOMATION_TRIGGERS,
    actions: AUTOMATION_ACTIONS,
    conditionOperators: ['eq', 'gte'],
    commonConditionPaths: ['amountMinor', 'reward.id', 'reward.title', 'user.id', 'user.displayName', 'text', 'scene', 'streaming'],
  }));
  app.post('/api/v1/automations', async (req, res, next) => { try { res.status(201).json(await automation.create(automationInput(req.body))); } catch (error) { next(error); } });
  app.put('/api/v1/automations/:id', async (req, res, next) => { try { res.json(await automation.update(String(req.params.id), automationInput(req.body))); } catch (error) { next(error); } });
  app.delete('/api/v1/automations/:id', async (req, res, next) => { try { await automation.remove(String(req.params.id)); res.status(204).end(); } catch (error) { next(error); } });
  app.post('/api/v1/automations/test', (req, res) => { const amountMinor = Number(req.body?.amountMinor); if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) { res.status(400).json({ ok: false, error: { code: 'AMOUNT_INVALID', message: 'Montant mineur invalide.' } }); return; } const event = eventCore.publish({ type: 'test.support', source: 'test', payload: { amountMinor, currency: 'EUR' } }); res.status(202).json({ eventId: event.eventId, correlationId: event.correlationId }); });
  app.get('/api/v1/supports', (_req, res) => { const sessionStartedAt = options.sessionStartedAt(); res.json({ ...support.snapshot(sessionStartedAt), sessionStartedAt, provider: streamlabs.state() }); });
  app.put('/api/v1/supports/streamlabs/config', async (req, res, next) => { try { if (!options.requireLocal(req, res)) return; const token = String(req.body?.token ?? '').trim(); if (!token || token.length > 1_000) throw new Error('Token Streamlabs invalide.'); await streamlabs.disconnect(); await options.secrets.setStreamlabsToken?.(token); streamlabs.configure(token); await streamlabs.connect(); res.json(streamlabs.state()); } catch (error) { next(error); } });
  app.delete('/api/v1/supports/streamlabs/config', async (req, res, next) => { try { if (!options.requireLocal(req, res)) return; await streamlabs.disconnect(); await options.secrets.clearStreamlabsToken?.(); streamlabs.configure(''); res.json(streamlabs.state()); } catch (error) { next(error); } });
  app.post('/api/v1/supports/streamlabs/test', async (req, res, next) => { try { if (!options.requireLocal(req, res)) return; const now = new Date().toISOString(); const value = await support.record({ id: `streamlabs:test:${Date.now()}`, provider: 'streamlabs', externalId: `test:${Date.now()}`, displayName: 'Test StreamDashboard', amountMinor: 100, currency: 'EUR', message: '[TEST] Soutien Streamlabs', receivedAt: now }); eventCore.publish({ type: 'test.support', source: 'test', correlationId: value.support.id, payload: { ...value.support, test: true } }); res.status(201).json({ support: value.support, test: true }); } catch (error) { next(error); } });
  app.get('/api/v1/wizebot', (_req, res) => res.json(wizebot.state()));
  app.put('/api/v1/wizebot/config', async (req, res, next) => { try { if (!options.requireLocal(req, res)) return; const apiBaseUrl = String(req.body?.apiBaseUrl ?? '').trim(); const token = String(req.body?.token ?? '').trim(); let url: URL; try { url = new URL(apiBaseUrl); } catch { throw new Error('Adresse API WizeBot invalide.'); } if (url.protocol !== 'https:' || !token || token.length > 1_000) throw new Error('Configuration WizeBot invalide.'); const configuration = { apiBaseUrl: url.toString(), token }; await options.secrets.setWizeBotConfiguration?.(configuration); wizebot.configure(configuration); res.json(await wizebot.refresh()); } catch (error) { next(error); } });
  app.post('/api/v1/wizebot/refresh', async (req, res, next) => { try { if (!options.requireLocal(req, res)) return; res.json(await wizebot.refresh()); } catch (error) { next(error); } });
  app.delete('/api/v1/wizebot/config', async (req, res, next) => { try { if (!options.requireLocal(req, res)) return; await options.secrets.clearWizeBotConfiguration?.(); wizebot.configure(null); res.json(wizebot.state()); } catch (error) { next(error); } });
}

function automationInput(value: unknown) {
  if (!object(value)) throw new Error('Automation invalide.');
  const conditions = Array.isArray(value.conditions) ? value.conditions : [];
  const actions = Array.isArray(value.actions) ? value.actions : [];
  const trigger = String(value.trigger);
  if (!(AUTOMATION_TRIGGERS as readonly string[]).includes(trigger)) throw new Error('Trigger non supporté.');
  if (!actions.length || actions.length > 20) throw new Error('Automation sans action ou trop complexe.');
  if (conditions.length > 20 || conditions.some(condition => !object(condition) || !['eq', 'gte'].includes(String(condition.operator)) || typeof condition.path !== 'string' || !condition.path.trim() || condition.path.length > 120 || !['string', 'number', 'boolean'].includes(typeof condition.value))) throw new Error('Condition invalide.');
  for (const action of actions) {
    if (!object(action) || !(AUTOMATION_ACTIONS as readonly string[]).includes(String(action.type)) || !object(action.payload)) throw new Error('Action invalide.');
    const payload = action.payload;
    switch (action.type) {
      case 'soundboard.play':
        if (typeof payload.soundId !== 'string' || !payload.soundId || payload.soundId.length > 100 || (payload.volume !== undefined && (typeof payload.volume !== 'number' || !Number.isFinite(payload.volume) || payload.volume < 0 || payload.volume > 1.5))) throw new Error('Action Soundboard invalide.');
        break;
      case 'obs.scene':
      case 'obs.media.restart':
        if (typeof (action.type === 'obs.scene' ? payload.scene : payload.input) !== 'string' || !String(action.type === 'obs.scene' ? payload.scene : payload.input).trim() || String(action.type === 'obs.scene' ? payload.scene : payload.input).length > 200) throw new Error('Action OBS invalide.');
        break;
      case 'timer.add':
        if (typeof payload.seconds !== 'number' || !Number.isFinite(payload.seconds) || payload.seconds < -86_400 || payload.seconds > 86_400) throw new Error('Action timer invalide.');
        break;
      case 'timer.start':
        if (payload.seconds !== undefined && (typeof payload.seconds !== 'number' || !Number.isFinite(payload.seconds) || payload.seconds < 1 || payload.seconds > 86_400)) throw new Error('Action timer invalide.');
        break;
      case 'timer.pause':
        if (Object.keys(payload).length) throw new Error('Action timer invalide.');
        break;
    }
  }
  const cooldownMs = Number(value.cooldownMs ?? 0);
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0 || cooldownMs > 86_400_000) throw new Error('Cooldown invalide.');
  const name = String(value.name ?? '').trim().slice(0, 120);
  if (!name) throw new Error('Nom d’automation requis.');
  return { name, enabled: value.enabled === true, trigger, conditions: conditions as Automation['conditions'], actions: actions as Automation['actions'], cooldownMs };
}
