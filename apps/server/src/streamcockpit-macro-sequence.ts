import type {ActionResult,ControlReceipt,DeckAction} from '../../../packages/contracts/src/control.js';

const allowed=new Set<DeckAction['type']>(['scene.set','mode.set','mic.toggle','timer.add','alert.play']);
const issue=(code:string,message:string)=>Object.assign(new Error(message),{name:code});
/** A manually pressed Deck macro is 2–5 EXISTING, OBS-only buttons.
 * No live start/stop, chat, cloud, replay, nested macros, autonomous triggers or delays.
 * Each step preserves the existing single-regie executor, confirmation and rights. */
export function macroSequenceSteps(macro:DeckAction,actions:readonly DeckAction[]):DeckAction[]{
  if(macro.type!=='macro.sequence'||typeof macro.value!=='string'||macro.value.length>500)
    throw issue('MACRO_INVALID','Définition de séquence invalide.');
  const ids=macro.value.split(',').map(v=>v.trim());
  if(ids.length<2||ids.length>5||new Set(ids).size!==ids.length||
    ids.some(v=>!/^[A-Za-z0-9_-]{1,64}$/.test(v)||v===macro.id))
    throw issue('MACRO_INVALID','La séquence demande de 2 à 5 IDs distincts de boutons existants.');
  const steps=ids.map(id=>actions.find(a=>a.id===id));
  if(steps.some(s=>!s||!allowed.has(s.type)))
    throw issue('MACRO_INVALID','Seules les actions OBS scène, mode, micro, minuteur et média sont permises.');
  return steps as DeckAction[];
}
export function validateMacroSequences(actions:readonly DeckAction[]):void{
  for(const macro of actions.filter(a=>a.type==='macro.sequence')){
    if(macro.shortcut)throw issue('MACRO_INVALID','Les séquences multi-étapes doivent être lancées manuellement depuis le Deck.');
    macroSequenceSteps(macro,actions);
  }
}
type Progress=NonNullable<ControlReceipt['macroSteps']>;
/** Caller owns the host's durable serialized ControlService queue and validates
 * its actor, context, config revision and original button before EACH step.
 * Every intent is persisted before dispatch; an uncertain effect never repeats.
 * A failed later step cannot undo confirmed earlier steps. */
export async function runManualMacroSequence(options:{
  macro:DeckAction;actions:readonly DeckAction[];id:string;receipt:ControlReceipt;
  persist:()=>Promise<void>;recheck:()=>Promise<void>;afterStep?:(step:DeckAction)=>Promise<void>;
  execute:(step:DeckAction,id:string,recheck:()=>Promise<void>)=>Promise<void|ActionResult>;
}):Promise<void>{
  const steps=macroSequenceSteps(options.macro,options.actions).map(s=>structuredClone(s));
  const progress:Progress=steps.map(s=>({id:s.id,type:s.type,status:'pending'}));
  options.receipt.macroSteps=progress;
  await options.persist(); // pin the full intended sequence in the same durable receipt
  let applied=0;
  for(let i=0;i<steps.length;i++){
    try{await options.recheck()}
    catch(error){
      if(applied)throw issue('ACTION_UNCERTAIN','Séquence interrompue après '+applied+' étape(s) confirmée(s) : vérifier avant toute nouvelle commande.');
      throw error;
    }
    progress[i]!.status='running';
    try{await options.persist()}
    catch(error){
      if(applied)throw issue('ACTION_UNCERTAIN','Journal de séquence indisponible après une action confirmée.');
      throw error;
    }
    try{
      await options.execute(steps[i]!,options.id+'_step_'+(i+1),options.recheck);
    }catch{
      progress[i]!.status='uncertain';
      try{await options.persist()}catch{/* uncertain durable write: no further effects */}
      throw issue('ACTION_UNCERTAIN','Étape '+(i+1)+' transmise ou interrompue sans confirmation : vérifier OBS avant toute nouvelle séquence.');
    }
    applied++;
    progress[i]!.status='succeeded';
    try{await options.persist()}
    catch{throw issue('ACTION_UNCERTAIN','Étape '+(i+1)+' exécutée mais journal non confirmé : vérifier avant toute nouvelle commande.')}
    try{await options.afterStep?.(steps[i]!)}
    catch{throw issue('ACTION_UNCERTAIN','Séquence arrêtée après une étape confirmée : contexte changé ou devenu indisponible.')}
  }
}
