import { createHash } from 'node:crypto';
import { AtomicJsonStore } from '../../../apps/server/src/storage.js';
import { validateMetadata } from '../../../apps/server/src/control-service.js';
import type { LiveMetadata } from '../../../packages/contracts/src/control.js';

export interface BroadcastPreparation {
  id: string;
  channelId: string;
  streamId: string;
  scheduledStartTime: string;
  privacyStatus: 'private' | 'unlisted' | 'public';
  madeForKids: boolean;
  metadata: LiveMetadata;
}
export interface PreparationReceipt {
  id: string;
  status: 'running' | 'succeeded' | 'partial' | 'uncertain' | 'failed';
  phase: 'checking' | 'creating' | 'binding' | 'metadata' | 'verified';
  channelId: string;
  broadcastId?: string;
  title: string;
  message: string;
  createdAt: string;
}
type Checkpoint = (phase: PreparationReceipt['phase'], broadcastId?: string) => Promise<void>;
export interface PreparationAdapter { prepareBroadcast(value: BroadcastPreparation, checkpoint: Checkpoint, guard: () => Promise<void>): Promise<void> }
interface Journal { entries: Record<string, { fingerprint: string; receipt: PreparationReceipt }> }

export function validatePreparation(value: BroadcastPreparation): BroadcastPreparation {
  if (!value || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value.id) || ['__proto__','constructor','prototype'].includes(value.id) || typeof value.channelId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value.channelId) || typeof value.streamId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value.streamId)) throw new Error('Identifiants de préparation YouTube invalides.');
  if (!['private','unlisted','public'].includes(value.privacyStatus) || typeof value.madeForKids !== 'boolean') throw new Error('Choisissez la visibilité et le public de la diffusion.');
  if (typeof value.scheduledStartTime !== 'string' || !Number.isFinite(Date.parse(value.scheduledStartTime))) throw new Error('Date de diffusion invalide.');
  return {id:value.id,channelId:value.channelId,streamId:value.streamId,scheduledStartTime:new Date(value.scheduledStartTime).toISOString(),privacyStatus:value.privacyStatus,madeForKids:value.madeForKids,metadata:validateMetadata(value.metadata)};
}
/** Write-ahead journal: retries and restarts never replay a broadcast insertion. */
export class YouTubePreparationService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private store: AtomicJsonStore<Journal>, private adapter: PreparationAdapter) {}
  static open(file: string, adapter: PreparationAdapter) { return new YouTubePreparationService(new AtomicJsonStore<Journal>(file), adapter); }
  prepare(input: BroadcastPreparation, guard: () => Promise<void> = async () => {}) {
    const operation=this.queue.then(async()=>{
      const value=validatePreparation(input),fingerprint=createHash('sha256').update(JSON.stringify(value)).digest('hex');
      const journal=await this.store.read({entries:{}}),existing=journal.entries[value.id];
      if(existing){
        if(existing.fingerprint!==fingerprint)throw new Error('Cette préparation existe avec d’autres paramètres. Actualisez son résultat.');
        if(existing.receipt.status==='running')return {...existing.receipt,status:'uncertain' as const,message:'Préparation interrompue. Consultez la liste des diffusions avant toute nouvelle création. Aucun renvoi automatique.'};
        return structuredClone(existing.receipt);
      }
      if(Date.parse(value.scheduledStartTime)<Date.now()-60_000)throw new Error('Choisissez une date de début actuelle ou future.');
      await guard();
      const receipt:PreparationReceipt={id:value.id,status:'running',phase:'checking',channelId:value.channelId,title:value.metadata.title,message:'Préparation en cours.',createdAt:new Date().toISOString()};
      // Keep every insertion ID: pruning would make an old retry create a duplicate.
      if(Object.keys(journal.entries).length>=10000)throw new Error('Journal de préparation plein. Archivez-le avant de créer une nouvelle diffusion.');
      journal.entries[value.id]={fingerprint,receipt};await this.store.write(journal);
      try{
        await this.adapter.prepareBroadcast(value,async(phase,broadcastId)=>{receipt.phase=phase;if(broadcastId)receipt.broadcastId=broadcastId;await this.store.write(journal);},guard);
        receipt.status='succeeded';receipt.message='Diffusion créée, flux associé et informations vérifiées. Choisissez-la pour le prochain lancement.';
      }catch(error){
        const e=error as Error & {httpStatus?:number;reason?:string};
        receipt.status=receipt.broadcastId?'partial':receipt.phase==='checking'||(e.httpStatus!==undefined&&e.httpStatus>=400&&e.httpStatus<500)?'failed':'uncertain';
        receipt.message=(e.message||'Préparation non confirmée.')+(receipt.status==='uncertain'?' Vérifiez la liste des diffusions avant toute nouvelle création. Aucun renvoi automatique.':receipt.status==='partial'?' La diffusion existe déjà : consultez-la dans la liste avant de recommencer.':'');
      }
      await this.store.write(journal);return structuredClone(receipt);
    });
    this.queue=operation.catch(()=>{});return operation;
  }
}
