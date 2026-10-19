import { createHash } from 'node:crypto';
import { AtomicJsonStore } from './storage.js';
import { WizeBotCatalogClient, type WizeBotCommand } from '../../../integrations/wizebot/src/catalog.js';
import type { ControlService } from './control-service.js';

type EditStatus = 'running'|'succeeded'|'failed'|'uncertain';
interface EditReceipt { id:string; fingerprint:string; channel:string; commandId:string; response:string; previousPublishedText:string; status:EditStatus; message:string; createdAt:string; messageId?:string }
interface CatalogState { channel:string; fetchedAt:string; items:WizeBotCommand[]; edits:EditReceipt[] }
export interface WizeBotEdit { id:string; issuedAt:string; channel:string; commandId:string; expectedRevision:string; response:string; retryOf?:string }
export class WizeBotService {
  private queue:Promise<unknown>=Promise.resolve();
  private constructor(private store:AtomicJsonStore<CatalogState>,private data:CatalogState,private channel:()=>string,private send:(text:string)=>Promise<{messageId:string}>,private catalog:Pick<WizeBotCatalogClient,'list'>,private wait:(ms:number)=>Promise<void>){}
  static async open(file:string,channel:()=>string,send:(text:string)=>Promise<{messageId:string}>,catalog:Pick<WizeBotCatalogClient,'list'>=new WizeBotCatalogClient(),wait=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms))) {
    const store=new AtomicJsonStore<CatalogState>(file);const data=await store.read({channel:'',fetchedAt:'',items:[],edits:[]});
    for(const edit of data.edits)if(edit.status==='running'){edit.status='uncertain';edit.message='Hôte redémarré : modification à vérifier chez WizeBot. Aucun renvoi automatique.';}
    await store.write(data);return new WizeBotService(store,data,channel,send,catalog,wait);
  }
  private serial<T>(fn:()=>Promise<T>){const op=this.queue.then(fn);this.queue=op.catch(()=>{});return op;}
  async stop(){await this.queue;}
  snapshot(){const channel=this.channel().toLowerCase();return structuredClone({...this.data,channel,items:this.data.channel===channel?this.data.items:[],fetchedAt:this.data.channel===channel?this.data.fetchedAt:'',edits:this.data.edits.filter(e=>e.channel===channel).slice(-30)});}
  private async readCurrent(){const channel=this.channel().toLowerCase();const items=await this.catalog.list(channel);if(channel!==this.channel().toLowerCase())throw new Error('Compte Twitch modifié pendant la lecture.');this.data={...this.data,channel,items,fetchedAt:new Date().toISOString()};await this.store.write(this.data);return items;}
  refresh(){return this.serial(async()=>{await this.readCurrent();for(const edit of this.data.edits){const item=this.data.items.find(c=>c.id===edit.commandId);if(edit.status==='uncertain'&&edit.channel===this.data.channel&&item?.kind==='SAY'&&item.publishedText===edit.response&&edit.previousPublishedText!==edit.response&&!/[\$<>]/.test(edit.response)){edit.status='succeeded';edit.message='Nouvelle réponse relue et confirmée sur le site WizeBot.';}}await this.store.write(this.data);return this.snapshot();});}
  import(control:ControlService,ids:string[],expectedRevision:number,channel:string){return this.serial(async()=>{
    if(channel!==this.channel().toLowerCase()||channel!==this.data.channel)throw new Error('La chaîne Twitch a changé. Actualisez la liste.');
    if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'))throw new Error('Sélectionnez de 1 à 100 commandes.');
    const items=await this.readCurrent();const c=control.snapshot().configuration;let added=0,updated=0,existing=0;
    for(const id of new Set(ids)){
      const item=items.find(c=>c.id===id);if(!item?.aliases.length)throw new Error('Commande absente de la liste publiée : actualisez la sélection.');
      let a=c.actions.find(a=>a.wizebot?.channel===channel&&a.wizebot.id===id);
      if(a){if(!item.aliases.includes(a.value)){a.value=item.aliases[0];updated++;}else existing++;continue;}
      a=c.actions.find(a=>a.type==='wizebot.command'&&item.aliases.includes(a.value)&&!a.wizebot);
      if(a){a.wizebot={channel,id};existing++;continue;}
      c.actions.push({id:`wiz_${channel}_${id}`,label:item.aliases[0],type:'wizebot.command',value:item.aliases[0],color:'purple',shortcut:'',wizebot:{channel,id}});added++;
    }
    await control.configure(c,expectedRevision);return {added,updated,existing,catalog:this.snapshot()};
  });}
  edit(input:WizeBotEdit){return this.serial(async()=>{
    if(!input||typeof input.response!=='string'||typeof input.channel!=='string'||!/^\d{1,30}$/.test(input.commandId)||!/^[A-Za-z0-9_-]{8,100}$/.test(input.id))throw new Error('Modification WizeBot invalide.');
    const response=input.response.trim(),command=`!cmd edit ${input.commandId} ${response}`;
    if(!response||command.length>500||/[\x00-\x1f\x7f]/.test(response)||/\$cmd\s*\(/i.test(response)||response.includes('###'))throw new Error('Réponse requise, une seule ligne, 500 caractères maximum avec la commande. Rétablissez les variables masquées ; les paramètres $cmd se règlent dans WizeBot.');
    const fingerprint=createHash('sha256').update(JSON.stringify([input.channel,input.commandId,input.expectedRevision,response])).digest('hex');
    const previous=this.data.edits.find(e=>e.id===input.id);
    if(previous){if(previous.fingerprint!==fingerprint)throw new Error('Identifiant déjà utilisé pour une autre modification.');return structuredClone(previous);}
    const age=Date.now()-Date.parse(input.issuedAt);if(!Number.isFinite(age)||age>30000||age< -5000)throw new Error('Modification expirée. Vérifiez l’horloge.');
    if(input.channel!==this.channel().toLowerCase())throw new Error('La chaîne Twitch a changé.');
    const items=await this.readCurrent(),item=items.find(c=>c.id===input.commandId);
    if(!item||item.kind!=='SAY')throw new Error('Seules les réponses texte publiées sont modifiables ici. Utilisez le panneau WizeBot pour cette commande.');
    if(item.revision!==input.expectedRevision)throw new Error('Commande modifiée chez WizeBot. Actualisez la liste avant de remplacer sa réponse.');
    const pending=this.data.edits.find(e=>e.channel===input.channel&&e.commandId===input.commandId&&e.response===response&&['running','uncertain'].includes(e.status));
    if(pending && input.retryOf!==pending.id && item.publishedText!==response)return structuredClone(pending);
    const receipt:EditReceipt={id:input.id,fingerprint,channel:input.channel,commandId:item.id,response,previousPublishedText:item.publishedText,status:'running',message:'Modification en cours',createdAt:new Date().toISOString()};
    this.data.edits.push(receipt);this.data.edits=this.data.edits.slice(-500);await this.store.write(this.data);
    try{
      if(item.publishedText===response&&!/[\$<>]/.test(response)){receipt.status='succeeded';receipt.message='Cette réponse est déjà publiée chez WizeBot. Aucun message envoyé.';}
      else {
        if(input.channel!==this.channel().toLowerCase())throw new Error('Compte Twitch modifié.');
        receipt.messageId=(await this.send(command)).messageId;receipt.status='uncertain';receipt.message='Envoyé dans Twitch ; modification WizeBot non confirmée. Vérifiez que la gestion des commandes par chat est activée dans WizeBot. Aucun renvoi automatique.';await this.store.write(this.data);
        for(const delay of [1000,2000,3000]){
          await this.wait(delay);
          try {const current=(await this.readCurrent()).find(c=>c.id===item.id);
            // Public descriptions can mask variables; only an exact, changed plain-text readback confirms this edit.
            if(current?.kind==='SAY'&&current.publishedText===response&&current.revision!==item.revision&&!/[\$<>]/.test(response)) {receipt.status='succeeded';receipt.message='Nouvelle réponse relue et confirmée sur le site WizeBot.';break;}
          } catch {break;}
        }
      }
    }catch(error){receipt.status=receipt.messageId||(error instanceof Error&&error.name==='ACTION_UNCERTAIN')?'uncertain':'failed';receipt.message=error instanceof Error?error.message:'Modification non confirmée.';}
    await this.store.write(this.data);return structuredClone(receipt);
  });}
}
