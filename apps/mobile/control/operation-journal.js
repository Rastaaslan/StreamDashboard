import {locateReplica} from './replica-identity.js';

const fields = new Set(['youtubePreparations', 'cloudMetadataReceipts', 'executorEdits']);
const terminal = value => ['succeeded','failed','applied','conflict'].includes((value.receipt || value).status);
/** Keep a small hot history. Cold receipts stay indexed and durable: deleting
 * an old idempotency proof would make a late retry unsafe. */
export function archiveReceipts(record, table) {
  for (const name of fields) {
    const entries = Object.entries(record.drafts?.[name] || {});
    for (const [id, value] of entries.slice(0, Math.max(0, entries.length - 128))) {
      if (!terminal(value)) continue;
      table.put(value, record.workspace + '/' + name + '/' + id);
      delete record.drafts[name][id];
    }
  }
}

export function createOperationJournal(db, scope) {
  const run = (name, id, value, claim) => new Promise((resolve, reject) => {
    if (!fields.has(name) || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) { reject(new Error('Identifiant de journal invalide.')); return; }
    const write = value !== undefined;
    const tx = db.transaction(['replicas','receipts'], write ? 'readwrite' : 'readonly');
    const replicas = tx.objectStore('replicas'), receipts = tx.objectStore('receipts');
    let result;
    const fail = error => { try { tx.abort(); } catch {} reject(error); };
    locateReplica(replicas, scope, location => {
      const request = replicas.get(location.scope);
      request.onsuccess = () => {
        const record = request.result;
        if (!record?.workspace || (location.workspace && record.workspace !== location.workspace)) { fail(new Error('Identité du journal modifiée.')); return; }
        const key = record.workspace + '/' + name + '/' + id, read = receipts.get(key);
        read.onsuccess = () => {
          const previous = read.result || record.drafts?.[name]?.[id];
          if (!write) { result = previous; return; }
          if (claim && previous) { result = {created:false, value:previous}; return; }
          if (!claim && !previous) { fail(new Error('Opération non admise dans le journal.')); return; }
          receipts.put(value,key);
          if (record.drafts?.[name]?.[id]) { delete record.drafts[name][id]; replicas.put(record,location.scope); }
          result = claim ? {created:true,value} : value;
        };
      };
    }, fail);
    tx.oncomplete = () => resolve(structuredClone(result));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Écriture du journal annulée.'));
  });
  return {
    read:(name,id)=>run(name,id),
    claim:(name,id,value)=>run(name,id,value,true),
    save:(name,id,value)=>run(name,id,value,false),
  };
}
