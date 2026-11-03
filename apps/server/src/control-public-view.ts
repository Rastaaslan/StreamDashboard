import type {ControlData,ControlReceipt} from '../../../packages/contracts/src/control.js';

/** Old journals may retain absolute paths; keep them host-only when projecting
 * HTTP/autonomy responses. The stored receipt is never rewritten by a read. */
export function publicControlReceipt(receipt:ControlReceipt):ControlReceipt{
  const result=structuredClone(receipt);
  if(result.result?.replayPath!==undefined){
    delete result.result.replayPath;
    result.message=result.status==='succeeded'?'Clip OBS confirmé sur la régie.':'Résultat du clip OBS à vérifier sur la régie.';
    result.result.message=result.message;
  }
  return result;
}
export function publicControlSnapshot(snapshot:ControlData):ControlData{
  return {...structuredClone(snapshot),receipts:snapshot.receipts.map(publicControlReceipt)};
}
