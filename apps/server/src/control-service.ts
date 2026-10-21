import { actionDefinition } from '../../mobile/shared/action-definition.js';
import { copyFile, constants, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AtomicJsonStore } from './storage.js';
import { defaultControlData, wizebotPresets, type ActionResult, type ControlData, type ControlConfiguration, type ControlRequest, type ControlReceipt, type Platform, type PlatformResult, type LiveMetadata, type DeckAction } from '../../../packages/contracts/src/control.js';

export interface ControlAdapter {
  live(platform: Platform): Promise<boolean>;
  preflight?(platform: Platform, start: boolean): Promise<void>;
  output(platform: Platform, start: boolean): Promise<void>;
  settle?(platform: Platform, start: boolean, requestId?: string): Promise<void>;
  metadata(platform: Platform, value: LiveMetadata): Promise<void>;
  action(action: DeckAction, id: string): Promise<void | ActionResult>;
}
const platforms: Platform[] = ['twitch', 'youtube'];
function fail(message: string, name = 'INVALID_REQUEST'): never { throw Object.assign(new Error(message), { name }); }
export function validateMetadata(value: LiveMetadata): LiveMetadata {
  if (!value || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 100) fail('Titre commun requis, 100 caractères maximum (YouTube).');
  if (typeof value.description !== 'string' || value.description.length > 5000 || /[<>]/.test(value.title + value.description)) fail('Description YouTube invalide.');
  if (typeof value.twitchGameId !== 'string' || !/^\d{0,30}$/.test(value.twitchGameId) || !/^\d{1,6}$/.test(value.youtubeCategoryId)) fail('Correspondance de catégories invalide.');
  if (!Array.isArray(value.tags) || value.tags.length > 10 || value.tags.some(t => typeof t !== 'string' || !/^[\p{L}\p{N}]{1,25}$/u.test(t))) fail('Maximum 10 tags alphanumériques de 25 caractères.');
  return { title: value.title.trim(), description: value.description, twitchGameId: value.twitchGameId, youtubeCategoryId: value.youtubeCategoryId, tags: [...value.tags] };
}
export function validateConfiguration(value: ControlConfiguration): ControlConfiguration {
  if (!value || value.version !== 1 || !Array.isArray(value.actions) || value.actions.length > 100) fail('Configuration du Deck invalide.');
  const ids = new Set<string>(), shortcuts = new Set<string>();
  const types = new Set(defaultControlData().configuration.actions.map(a => a.type));
  ['timer.add','scene.set','sound.play','sound.stop','alert.play','chat.send','wizebot.command','replay.save','replay.start','replay.stop','live.start','live.stop'].forEach(t => types.add(t as DeckAction['type']));
  for (const a of value.actions) {
    if (!a || !/^[a-zA-Z0-9_-]{1,64}$/.test(a.id) || ids.has(a.id) || typeof a.label !== 'string' || !a.label.trim() || a.label.length > 80 || !types.has(a.type) || typeof a.value !== 'string' || a.value.length > 500 || !['purple','green','amber','red'].includes(a.color)) fail('Bouton invalide ou identifiant dupliqué.');
    if (typeof a.shortcut !== 'string' || (a.shortcut && (!/^Control\+Alt\+Shift\+F(?:[1-9]|1\d|2[0-4])$/.test(a.shortcut) || shortcuts.has(a.shortcut)))) fail('Raccourci invalide ou déjà utilisé.');
    if (a.type === 'timer.add' && (!Number.isFinite(Number(a.value)) || Math.abs(Number(a.value)) > 86400)) fail('Durée invalide.');
    if (a.type === 'wizebot.command' && (!/^![\p{L}\p{N}_-]+(?: [^\r\n]*)?$/u.test(a.value) || /[\x00-\x1f\x7f]/.test(a.value))) fail('Une commande WizeBot commence par ! et tient sur une seule ligne.');
    if (a.wizebot && (a.type !== 'wizebot.command' || !/^[a-z0-9_]{1,25}$/.test(a.wizebot.channel) || !/^\d{1,30}$/.test(a.wizebot.id))) fail('Lien WizeBot invalide.');
    ids.add(a.id); if (a.shortcut) shortcuts.add(a.shortcut);
  }
  for (const p of platforms) {
    const out = value.outputs?.[p];
    if (!out || !['unconfigured','main','output','aitum-suite'].includes(out.kind) || typeof out.name !== 'string' || out.name.length > 200 || (['output','aitum-suite'].includes(out.kind) && !out.name.trim())) fail('Sortie OBS invalide.');
  }
  if (!value.youtube || typeof value.youtube.clientId !== 'string' || value.youtube.clientId.length > 250 || !/^[A-Za-z0-9_-]{0,120}$/.test(value.youtube.broadcastId) || !/^[A-Za-z0-9_-]{0,120}$/.test(value.youtube.channelId)) fail('Cible YouTube invalide.');
  const metadata = value.metadata.title ? validateMetadata(value.metadata) : defaultControlData().configuration.metadata;
  if (value.replayAutoStart !== undefined && typeof value.replayAutoStart !== 'boolean') fail('Réglage de replay invalide.');
  return { version: 1, revision: value.revision, actions: value.actions.map(({id,label,type,value,color,shortcut,wizebot}) => ({id,label,type,value,color,shortcut,...(wizebot?{wizebot:{channel:wizebot.channel,id:wizebot.id}}:{})})), outputs: structuredClone(value.outputs), youtube: structuredClone(value.youtube), metadata, replayAutoStart: value.replayAutoStart !== false };
}

/** One durable action journal for keyboard, desktop and phone. Never replays an uncertain side effect. */
export class ControlService {
  private queue: Promise<unknown> = Promise.resolve();
  private inFlight = new Map<string, Promise<ControlReceipt>>();
  private pendingActions = new Map<string, Promise<ControlReceipt>>();
  private stopped = false;
  private constructor(private store: AtomicJsonStore<ControlData>, private data: ControlData, private adapter: ControlAdapter, private notify: () => void, private wait: (ms: number) => Promise<void>) {}
  static async open(file: string, adapter: ControlAdapter, notify = () => {}, wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))) {
    const store = new AtomicJsonStore<ControlData>(file);
    const existed = await stat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
    const fallback = defaultControlData(); delete fallback.featureVersion;
    const data = await store.read(fallback);
    data.configuration = validateConfiguration(data.configuration);
    if ((data.featureVersion ?? 0) < 5) {
      await copyFile(file, file + '.pre-rc5', constants.COPYFILE_EXCL).catch(error => { if (!['EEXIST','ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; });
      const oldMacro = data.configuration.actions.find(a => a.shortcut === 'Control+Alt+Shift+F5' && (
        (a.id === 'timer-plus' && a.type === 'timer.add' && a.value === '300' && a.label === '+ 5 minutes' && a.color === 'green') ||
        (a.id === 'sound-stop' && a.type === 'sound.stop' && a.value === '' && a.label === 'Arrêter le son' && a.color === 'red')));
      if (oldMacro && !data.configuration.actions.some(a => a.id === 'clip-save')) Object.assign(oldMacro, defaultControlData().configuration.actions.find(a => a.id === 'clip-save'));
      for (const preset of wizebotPresets()) if (data.configuration.actions.length < 100 && !data.configuration.actions.some(a => a.id === preset.id || (a.type === preset.type && a.value === preset.value))) data.configuration.actions.push(preset);
      data.featureVersion = 5;
      // A brand-new store already contains the defaults and starts at revision 0.
      if (existed) data.configuration.revision++;
    }
    for (const receipt of data.receipts) if (receipt.status === 'running') { receipt.status = 'uncertain'; receipt.message = 'Hôte redémarré : vérifier le résultat avant de réessayer.'; }
    await store.write(data);
    return new ControlService(store, data, adapter, notify, wait);
  }
  snapshot() { return structuredClone(this.data); }
  get hasPendingActions() { return this.inFlight.size > 0 || this.pendingActions.size > 0; }
  async stop() { this.stopped = true; await this.queue; }
  private serialize<T>(fn: () => Promise<T>): Promise<T> { const op = this.queue.then(fn); this.queue = op.catch(() => {}); return op; }
  private async save() { await this.store.write(this.data); this.notify(); }
  configure(value: ControlConfiguration, expectedRevision: number) {
    return this.serialize(async () => {
      if (expectedRevision !== this.data.configuration.revision) fail('Configuration modifiée sur un autre appareil. Rechargez avant d’enregistrer.', 'REVISION_CONFLICT');
      const next = validateConfiguration(value); next.revision = expectedRevision + 1;
      if (JSON.stringify(next.metadata) !== JSON.stringify(this.data.configuration.metadata)) fail('Modifiez les informations depuis le formulaire commun Twitch et YouTube.');
      // Publish in memory only after the atomic write has succeeded.
      const data = { ...this.data, configuration: next }; await this.store.write(data); this.data = data; this.notify(); return this.snapshot();
    });
  }
  execute(request: ControlRequest, authorize?: (action:string)=>void): Promise<ControlReceipt> {
    if (this.stopped) return Promise.reject(new Error('Hôte en cours d’arrêt.'));
    if (!request || !/^[A-Za-z0-9_-]{8,100}$/.test(request.id) || typeof request.action !== 'string' || request.action.length > 100 || (request.platform !== undefined && !platforms.includes(request.platform))) return Promise.reject(new Error('Commande invalide.'));
    if (request.soundId !== undefined && (request.action !== 'sound.play' || !/^[A-Za-z0-9._:-]{1,100}$/.test(request.soundId))) return Promise.reject(new Error('Son invalide.'));
    const fingerprint = createHash('sha256').update(JSON.stringify({action:request.action, platform:request.platform, metadata:request.metadata, soundId:request.soundId, expectedRevision:request.expectedRevision, expectedAction:request.expectedAction})).digest('hex');
    const previous = this.data.receipts.find(r => r.id === request.id);
    if (previous && previous.fingerprint !== fingerprint) return Promise.reject(new Error('Identifiant déjà utilisé pour une autre commande.'));
    const active = this.inFlight.get(request.id); if (active) return active;
    if (previous) return Promise.resolve(structuredClone(previous));
    const timestamp = Date.parse(request.issuedAt);
    if (!Number.isFinite(timestamp) || Date.now() - timestamp > 30_000 || timestamp - Date.now() > 5_000) return Promise.reject(new Error('Commande expirée. Vérifiez l’horloge et recommencez.'));
    // A second press with a different ID while the same action is pending joins its result.
    const actionKey = `${request.action}:${request.soundId ?? ''}:${request.platform ?? 'both'}:${request.expectedAction ? actionDefinition(request.expectedAction) : ''}`;
    const pending = this.pendingActions.get(actionKey);
    if (pending && request.action !== 'metadata.apply') return pending;
    const operation = this.serialize(async () => {
      if (Date.now() - timestamp > 30_000) fail('Commande devenue obsolète dans la file d’attente.');
      const receipt: ControlReceipt = { id:request.id, action:request.action, fingerprint, status:'running', message:'Exécution sur le PC de stream', createdAt:new Date().toISOString() };
      this.data.receipts.push(receipt); this.data.receipts = this.data.receipts.slice(-2000); await this.save();
      try {
        authorize?.(request.action);
        if (request.expectedAction !== undefined) {
          const actual = this.data.configuration.actions.find(a => a.id === request.expectedAction!.id);
          const expected = actionDefinition(request.expectedAction);
          if (!expected || actionDefinition(actual) !== expected || (request.action !== actual!.id && !(['live.start','live.stop'].includes(actual!.type) && request.action === actual!.type)))
            fail('Ce bouton a changé sur cet appareil. Vérifiez son association avant de réessayer.', 'REVISION_CONFLICT');
        }
        if (request.action === 'metadata.apply') {
          if (request.expectedRevision !== this.data.configuration.revision) fail('Informations modifiées sur un autre appareil.', 'REVISION_CONFLICT');
          const metadata = validateMetadata(request.metadata!);
          this.data.configuration = { ...this.data.configuration, metadata, revision:this.data.configuration.revision + 1 }; await this.save();
        }
        if (['live.start','live.stop','metadata.apply','metadata.retry'].includes(request.action)) {
          receipt.platforms = {};
          for (const p of (request.platform ? [request.platform] : platforms)) {
            if (this.stopped) throw new Error('Hôte en cours d’arrêt.');
            let result: PlatformResult;
            try {
              if (request.action.startsWith('metadata.')) {
                await this.adapter.metadata(p, validateMetadata(this.data.configuration.metadata));
                result = {status:'succeeded', message:'Informations confirmées', observedAt:new Date().toISOString()};
              } else {
                const wanted = request.action === 'live.start';
                let live: boolean | undefined = await this.adapter.live(p);
                let confirmationError: string | undefined;
                if (live !== wanted || !wanted) {
                  // Refuse an unusable destination before sending anything to OBS.
                  await this.adapter.preflight?.(p, wanted);
                  // An unknown dispatch result permits observation, never an automatic second command.
                  let observeOnly = false;
                  live = undefined;
                  try { await this.adapter.output(p, wanted); }
                  catch (error) {
                    if (!(error instanceof Error) || error.name !== 'ACTION_UNCERTAIN') throw error;
                    confirmationError = error.message; observeOnly = true;
                  }
                  // YouTube may need a full minute to confirm its live transition.
                  // The deadline also accounts for time spent reading the provider.
                  const attempts = p === 'youtube' ? 41 : 12;
                  const deadline = Date.now() + (p === 'youtube' ? 60_000 : 16_500);
                  for (let n = 0; n < attempts; n++) {
                    if (n > 0 && Date.now() >= deadline) break;
                    if (!observeOnly) {
                      try { await this.adapter.settle?.(p, wanted, request.id); }
                      catch (error) {
                        if (!(error instanceof Error) || !['ACTION_UNCERTAIN','ACTION_OBSERVATION_UNAVAILABLE'].includes(error.name)) throw error;
                        confirmationError = error.message;
                        if (error.name === 'ACTION_UNCERTAIN') observeOnly = true;
                      }
                    }
                    try { live = await this.adapter.live(p); }
                    catch (error) {
                      // A failed GET says nothing about a side effect. Keep settling:
                      // the adapter deduplicates any accepted/uncertain transition.
                      live = undefined;
                      confirmationError = 'Commande envoyée ; état de la plateforme indisponible. ' + (error instanceof Error ? error.message : 'Vérifiez le résultat avant reprise.');
                    }
                    if (live === wanted || this.stopped) break;
                    const remaining = deadline - Date.now();
                    if (remaining <= 0) break;
                    if (n < attempts - 1) await this.wait(Math.min(1500, remaining));
                  }
                }
                result = {status:live === wanted ? 'succeeded' : 'uncertain', message:live === wanted ? (live ? 'En direct confirmé par la plateforme' : 'Arrêt confirmé par la plateforme') : confirmationError || 'Commande envoyée ; état attendu non confirmé. Vérifier avant reprise.', ...(live === undefined ? {} : {live}), observedAt:new Date().toISOString()};
              }
            } catch (error) { result = {status:error instanceof Error && error.name === 'ACTION_UNCERTAIN' ? 'uncertain' : 'failed', message:error instanceof Error ? error.message : 'Service indisponible', observedAt:new Date().toISOString()}; }
            receipt.platforms[p] = result;
            if (request.action.startsWith('metadata.')) this.data.metadataResults[p] = result;
            await this.save();
          }
          const values = Object.values(receipt.platforms);
          receipt.status = values.every(v => v.status === 'succeeded') ? 'succeeded' : values.some(v => v.status === 'succeeded') ? 'partial' : values.some(v => v.status === 'uncertain') ? 'uncertain' : 'failed';
          receipt.message = receipt.status === 'succeeded' ? 'Commande confirmée' : receipt.status === 'partial' ? 'Résultat partiel : une plateforme nécessite votre attention' : 'Commande non confirmée';
        } else {
          const action: DeckAction | undefined = ['sound.stop','replay.save','replay.start','replay.stop'].includes(request.action) || (request.action === 'sound.play' && request.soundId)
            ? { id: request.action, label: request.action, type: request.action as DeckAction['type'], value: request.soundId ?? '', color: 'green', shortcut: '' }
            : this.data.configuration.actions.find(a => a.id === request.action);
          if (!action) fail('Action inconnue.');
          if (action.type === 'live.start' || action.type === 'live.stop') fail('Utilisez la commande commune de diffusion.');
          const result = await this.adapter.action(action, request.id); receipt.status = 'succeeded'; receipt.message = result?.message || 'Exécution confirmée par le PC de stream'; if (result) receipt.result = result;
        }
      } catch (error) { receipt.status = error instanceof Error && error.name === 'ACTION_UNCERTAIN' ? 'uncertain' : 'failed'; receipt.message = error instanceof Error ? error.message : 'Échec de la commande'; }
      receipt.finishedAt = new Date().toISOString(); await this.save(); return structuredClone(receipt);
    });
    this.inFlight.set(request.id, operation); this.pendingActions.set(actionKey, operation);
    void operation.finally(() => { this.inFlight.delete(request.id); if (this.pendingActions.get(actionKey) === operation) this.pendingActions.delete(actionKey); }).catch(() => {}); return operation;
  }
}
