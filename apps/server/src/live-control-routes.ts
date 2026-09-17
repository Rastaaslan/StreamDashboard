import type express from 'express';
import type { ActionCommand, Sound } from '../../../packages/contracts/src/index.js';
import type { Automation } from '../../../packages/core/src/live-control-domains.js';
import type { EventCore } from '../../../packages/core/src/events.js';
import type { StreamlabsAdapter } from '../../../integrations/streamlabs/src/adapter.js';
import type { SecretStore } from './storage.js';
import { validateSound, type SoundboardRuntime } from './soundboard-runtime.js';
import type { AutomationRuntime } from './automation-runtime.js';
import type { SupportRuntime } from './support-runtime.js';

interface Options {
  app: express.Application; soundboard: SoundboardRuntime; automation: AutomationRuntime; support: SupportRuntime; streamlabs: StreamlabsAdapter; eventCore: EventCore; secrets: SecretStore;
  requireLocal(req: express.Request, res: express.Response): boolean; isRemote(req: express.Request): boolean; save(): Promise<void>;
  sounds(): Sound[]; setSounds(value: Sound[]): void; sessionStartedAt(): string | null;
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export function registerLiveControlRoutes(options: Options) {
  const { app, soundboard, automation, support, streamlabs, eventCore } = options;
  app.get('/api/v1/events', (req, res) => { const string = (value: unknown, max: number) => typeof value === 'string' && value.length <= max ? value : undefined; res.json({ items: eventCore.recent({ type: string(req.query.type, 120), source: string(req.query.source, 80), correlationId: string(req.query.correlationId, 128), limit: Number(req.query.limit) || 100 }) }); });
  app.get('/api/v1/soundboard', async (_req, res, next) => { try { res.json(await soundboard.snapshot()); } catch (error) { next(error); } });
  app.put('/api/v1/soundboard/catalog', async (req, res, next) => { try { if (!options.requireLocal(req, res)) return; if (!Array.isArray(req.body?.sounds) || req.body.sounds.length > 500) throw new Error('Catalogue soundboard invalide.'); const sounds = req.body.sounds.map(validateSound); soundboard.replace(sounds); options.setSounds(sounds); await options.save(); res.json(await soundboard.snapshot()); } catch (error) { next(error); } });
  app.put('/api/v1/soundboard/sounds/:id', async (req, res, next) => { try { const sounds = options.sounds(); const sound = sounds.find(value => value.id === req.params.id); if (!sound) { res.status(404).json({ ok: false, error: { code: 'SOUND_NOT_FOUND', message: 'Son introuvable.' } }); return; } if (!object(req.body) || Object.keys(req.body).some(key => !['favorite', 'volume', 'enabled', 'cooldownMs', 'category', 'outputId'].includes(key))) throw new Error('Modification soundboard invalide.'); Object.assign(sound, validateSound({ ...sound, ...req.body })); soundboard.replace(sounds); options.setSounds(sounds); await options.save(); res.json(await soundboard.snapshot()); } catch (error) { next(error); } });
  app.post('/api/v1/soundboard/play', async (req, res, next) => { try { const command: ActionCommand<{ soundId: string; volume?: number }> = { commandId: String(req.body?.commandId ?? ''), correlationId: typeof req.body?.correlationId === 'string' ? req.body.correlationId : undefined, type: 'soundboard.play', origin: options.isRemote(req) ? 'android' : 'desktop', issuedAt: typeof req.body?.issuedAt === 'string' ? req.body.issuedAt : new Date().toISOString(), payload: { soundId: String(req.body?.soundId ?? ''), ...(typeof req.body?.volume === 'number' ? { volume: req.body.volume } : {}) } }; eventCore.publish({ type: 'soundboard.play.requested', source: 'runtime', correlationId: command.correlationId, payload: { commandId: command.commandId, soundId: command.payload.soundId } }); const ack = await soundboard.play(command); eventCore.publish({ type: ack.status === 'succeeded' ? 'soundboard.played' : 'soundboard.failed', source: 'runtime', correlationId: ack.correlationId, payload: ack }); res.status(ack.status === 'succeeded' ? 200 : 409).json(ack); } catch (error) { next(error); } });
  app.post('/api/v1/soundboard/stop', async (_req, res, next) => { try { await soundboard.stop(); res.status(204).end(); } catch (error) { next(error); } });

  app.get('/api/v1/automations', (_req, res) => res.json({ items: automation.list(), executions: automation.recent() }));
  app.post('/api/v1/automations', async (req, res, next) => { try { res.status(201).json(await automation.create(automationInput(req.body))); } catch (error) { next(error); } });
  app.put('/api/v1/automations/:id', async (req, res, next) => { try { res.json(await automation.update(String(req.params.id), automationInput(req.body))); } catch (error) { next(error); } });
  app.delete('/api/v1/automations/:id', async (req, res, next) => { try { await automation.remove(String(req.params.id)); res.status(204).end(); } catch (error) { next(error); } });
  app.post('/api/v1/automations/test', (req, res) => { const amountMinor = Number(req.body?.amountMinor); if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) { res.status(400).json({ ok: false, error: { code: 'AMOUNT_INVALID', message: 'Montant mineur invalide.' } }); return; } const event = eventCore.publish({ type: 'test.support', source: 'test', payload: { amountMinor, currency: 'EUR' } }); res.status(202).json({ eventId: event.eventId, correlationId: event.correlationId }); });
  app.get('/api/v1/supports', (_req, res) => { const sessionStartedAt = options.sessionStartedAt(); res.json({ ...support.snapshot(sessionStartedAt), sessionStartedAt, provider: streamlabs.state() }); });
  app.put('/api/v1/supports/streamlabs/config', async (req, res, next) => { try { if (!options.requireLocal(req, res)) return; const token = String(req.body?.token ?? '').trim(); if (token.length > 1_000) throw new Error('Token Streamlabs invalide.'); if (token) await options.secrets.setStreamlabsToken?.(token); else await options.secrets.clearStreamlabsToken?.(); streamlabs.configure(token); await streamlabs.connect(); res.json(streamlabs.state()); } catch (error) { next(error); } });
}

function automationInput(value: unknown) {
  if (!object(value)) throw new Error('Automation invalide.'); const conditions = Array.isArray(value.conditions) ? value.conditions : []; const actions = Array.isArray(value.actions) ? value.actions : [];
  if (!['support.received', 'twitch.raid', 'test.support'].includes(String(value.trigger))) throw new Error('Trigger non supporté.');
  if (conditions.some(condition => !object(condition) || !['eq', 'gte'].includes(String(condition.operator)) || typeof condition.path !== 'string')) throw new Error('Condition invalide.');
  if (actions.some(action => !object(action) || action.type !== 'soundboard.play' || !object(action.payload) || typeof action.payload.soundId !== 'string')) throw new Error('Action invalide.');
  return { name: String(value.name ?? '').slice(0, 120), enabled: value.enabled === true, trigger: String(value.trigger), conditions: conditions as Automation['conditions'], actions: actions as Automation['actions'], cooldownMs: Number(value.cooldownMs ?? 0) };
}
