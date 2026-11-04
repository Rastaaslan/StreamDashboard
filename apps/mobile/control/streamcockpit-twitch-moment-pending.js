// F04: a local *read-only reconciliation hint*, never a Twitch retry or permission grant.
// A pending POST is saved synchronously BEFORE sending it. No tokens or clip URLs are stored.
const KEY='sd3.f04.twitch-moment-uncertain.v1';
const MAX_AGE_MS=7*24*60*60*1000;
const MAX_RECORDS=8;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validScope=(source,account)=>typeof source==='string'&&source.length>0&&source.length<=512&&
  typeof account==='string'&&account.length>0&&account.length<=128;
// Validate the *entire* persisted journal before considering the time-bounded hints.
// Filtering malformed rows would silently lose a UUID that may represent an executed POST.
const safeRow=(r,now)=>r&&typeof r==='object'&&!Array.isArray(r)&&
  Object.keys(r).length===5&&['source','account','id','kind','createdAt'].every(k=>Object.hasOwn(r,k))&&
  validScope(r.source,r.account)&&UUID.test(r.id)&&
  (r.kind==='clip'||r.kind==='marker')&&Number.isSafeInteger(r.createdAt)&&
  r.createdAt>=0&&r.createdAt<=now;
const validRow=(r,now)=>safeRow(r,now)&&now-r.createdAt<MAX_AGE_MS;
// An unrecognized top-level field may contain a receipt from another schema.
// Never overwrite or interpret such a journal as if it contained only rows.
const knownJournal=data=>data&&typeof data==='object'&&!Array.isArray(data)&&
  Object.keys(data).length===2&&Object.hasOwn(data,'version')&&Object.hasOwn(data,'rows')&&
  data.version===1&&Array.isArray(data.rows)&&data.rows.length<=MAX_RECORDS;
function store(view){try{return view?.localStorage}catch{return undefined}}
// Forensic backup is strictly opt-in and local: preserve the exact raw journal,
// including invalid JSON, without interpreting, trimming, clearing, or uploading it.
// The caller MUST warn that unknown corrupt fields may contain sensitive data.
export function readUncertainMomentBackup(view){
  try{
    const raw=store(view)?.getItem(KEY);
    return typeof raw==='string'&&raw.length>0&&raw.length<=1024*1024?raw:null;
  }catch{return null}
}
// JSON.parse silently accepts duplicate keys, discarding earlier values (possibly
// executed Twitch UUIDs). Trust only the exact canonical representation produced
// by write(): noncanonical/edited journals must remain untouched for human review.
function parseCanonicalJournal(raw){
  const data=JSON.parse(raw);
  if(JSON.stringify(data)!==raw)throw Error('BAD_STORAGE');
  return data;
}
function read(storage,now){
  const raw=storage.getItem(KEY);
  if(raw===null)return [];
  if(raw.length>8192)throw Error('OVER_LIMIT');
  const data=parseCanonicalJournal(raw);
  if(!knownJournal(data))throw Error('BAD_STORAGE');
  const scopes=new Set();
  for(const row of data.rows){
    if(!safeRow(row,now))throw Error('BAD_ROW');
    const scope=JSON.stringify([row.source,row.account]);
    if(scopes.has(scope))throw Error('DUPLICATE_SCOPE');
    scopes.add(scope);
  }
  // An expired UUID can still represent a successfully executed Twitch POST.
  // Do not silently discard it during a later journal write for *any* account.
  // The 7-day lookup window closes, but the raw evidence stays until supervised reconciliation.
  if(data.rows.some(r=>!validRow(r,now)))throw Error('EXPIRED_UNREVIEWED');
  return data.rows;
}
// A false read-back of a corrupt or missing journal must never count as a
// successful clear: loadUncertainMoment() deliberately returns null on errors.
// Verify the exact bytes stored before acknowledging any journal mutation.
function write(storage,rows){
  const raw=JSON.stringify({version:1,rows});
  storage.setItem(KEY,raw);
  return storage.getItem(KEY)===raw;
}
// localStorage alone cannot atomically claim a receipt across different tabs.
// The browser's native same-origin Web Lock serializes all *production UI* journal
// mutations. Never wait/retry a contested lock or fall back to an unlocked POST.
// This guard protects the local hint only; it never grants permission to send.
export async function withExclusiveMomentJournal(view,operation){
  try{
    const locks=view?.navigator?.locks;
    if(typeof locks?.request!=='function'||typeof operation!=='function')return false;
    const result=await locks.request('sd3.f04.twitch-moment-journal.v1',
      {mode:'exclusive',ifAvailable:true},lock=>lock?operation()===true:false);
    return result===true;
  }catch{return false}
}
// Operator-requested, redacted diagnosis. Only a fixed category may leave this
// module: never a UUID, scope, raw field, exception message, or other account count.
// Reading even an invalid/expired journal must not mutate, clear or permit a POST.
export function describeUncertainMomentIssue(view,source,account,now=Date.now()){
  if(!validScope(source,account))return {code:'unavailable'};
  const storage=store(view);if(!storage)return {code:'unavailable'};
  try{
    const rows=read(storage,now);
    return {code:rows.some(r=>r.source===source&&r.account===account)?'pending':'clear'};
  }catch(error){
    if(error instanceof SyntaxError)return {code:'corrupt-json'};
    if(error?.message==='OVER_LIMIT')return {code:'too-large'};
    if(error?.message==='BAD_STORAGE')return {code:'unknown-schema'};
    if(error?.message==='EXPIRED_UNREVIEWED')return {code:'expired-unreviewed'};
    if(error?.message==='BAD_ROW'||error?.message==='DUPLICATE_SCOPE')return {code:'invalid-rows'};
    return {code:'unavailable'};
  }
}
// Read-only diagnostic: never erase or interpret an invalid journal as an empty one.
// It reveals neither raw journal data nor account/host identifiers to the UI.
export function diagnoseUncertainMomentStore(view,source,account,now=Date.now()){
  if(!validScope(source,account))return {state:'blocked'};
  const storage=store(view);if(!storage)return {state:'blocked'};
  try{
    const row=read(storage,now).find(r=>r.source===source&&r.account===account);
    return row?{state:'pending',receipt:{id:row.id,kind:row.kind}}:{state:'clear'};
  }catch{return {state:'blocked'}}
}
// Narrow forensic lookup ONLY: a canonical but blocked journal may retain one
// unambiguous current-scope UUID, including an expired reference. Expiration ends
// trusted admission/clearing, not GET-only human review of a possibly executed POST.
// Never repair, trim, clear, admit, retry, or reveal another account's reference.
// An unparseable document or ambiguous/malformed row for this scope is UNKNOWN.
export function recoverUncertainMomentForReview(view,source,account,now=Date.now()){
  if(!validScope(source,account))return null;
  try{
    const storage=store(view),raw=storage?.getItem(KEY);
    if(!raw||raw.length>8192)return null;
    const data=parseCanonicalJournal(raw);
    if(!knownJournal(data))return null;
    let found=null;
    for(const row of data.rows){
      if(!row||typeof row!=='object'||Array.isArray(row))return null;
      if(row.source!==source||row.account!==account)continue;
      if(found||!safeRow(row,now))return null;
      if(!validRow(row,now)){
        // Expired hints are too old for trusted lookup. Permit GET-only review
        // only if every row is unambiguous and structurally valid (no partial salvage).
        const scopes=new Set();
        for(const entry of data.rows){
          if(!safeRow(entry,now))return null;
          const scope=JSON.stringify([entry.source,entry.account]);
          if(scopes.has(scope))return null;
          scopes.add(scope);
        }
      }
      found={id:row.id,kind:row.kind};
    }
    return found;
  }catch{return null}
}
export function loadUncertainMoment(view,source,account,now=Date.now()){
  if(!validScope(source,account))return null;
  const storage=store(view);if(!storage)return null;
  try{
    const row=read(storage,now).find(r=>r.source===source&&r.account===account);
    return row?{id:row.id,kind:row.kind}:null;
  }catch{return null}
}
export function rememberUncertainMoment(view,source,account,receipt,now=Date.now()){
  if(!validScope(source,account)||!validRow({...receipt,source,account,createdAt:now},now))return false;
  const storage=store(view);if(!storage)return false;
  try{
    const rows=read(storage,now);
    // Never replace an older uncertain confirmation, even for the same host/account.
    // Its provider POST may have succeeded and its original UUID is required for GET-only reconciliation.
    if(rows.some(r=>r.source===source&&r.account===account))return false;
    if(rows.length>=MAX_RECORDS)return false; // Never silently evict a pending receipt.
    rows.push({source,account,id:receipt.id,kind:receipt.kind,createdAt:now});
    return write(storage,rows)&&loadUncertainMoment(view,source,account,now)?.id===receipt.id;
  }catch{return false}
}
// A stale tab must never clear a newer pending request. Require the exact receipt
// acknowledged by this view, not just a host/account match.
export function clearUncertainMoment(view,source,account,expected,now=Date.now()){
  if(!validScope(source,account)||!expected||typeof expected!=='object'||
    typeof expected.id!=='string'||typeof expected.kind!=='string'||
    !UUID.test(expected.id)||!['clip','marker'].includes(expected.kind))return false;
  const storage=store(view);if(!storage)return false;
  try{
    const rows=read(storage,now);
    const index=rows.findIndex(r=>r.source===source&&r.account===account);
    if(index<0||rows[index].id!==expected.id||rows[index].kind!==expected.kind)return false;
    rows.splice(index,1);
    // loadUncertainMoment() returns null both when the receipt is absent AND
    // when a post-write storage read fails. A transient failure must never
    // acknowledge a successful provider reconciliation to the operator.
    // Require the exact persisted JSON string again, not a nullable lookup.
    return write(storage,rows)&&storage.getItem(KEY)===JSON.stringify({version:1,rows});
  }catch{return false}
}
// Expired receipts cannot be cleared by the normal path. After an operator has
// explicitly downloaded an exact raw copy and externally verified Twitch, permit
// reconciliation of ONE unambiguous, expired UUID under the caller's Web Lock.
// Every other row (including other accounts) must survive byte-for-byte in data.
// Invalid/noncanonical journals remain read-only and require separate review.
export function reconcileExpiredUncertainMoment(view,source,account,expected,exportedSnapshot,now=Date.now()){
  if(!validScope(source,account)||!expected||typeof expected!=='object'||
    !UUID.test(expected.id)||!['clip','marker'].includes(expected.kind)||
    typeof exportedSnapshot!=='string'||!exportedSnapshot)return false;
  try{
    const storage=store(view),raw=storage?.getItem(KEY);
    if(!raw||raw!==exportedSnapshot||raw.length>8192)return false;
    const data=parseCanonicalJournal(raw);
    if(!knownJournal(data))return false;
    const scopes=new Set();let index=-1;
    for(let i=0;i<data.rows.length;i++){
      const row=data.rows[i];
      if(!safeRow(row,now))return false;
      const scope=JSON.stringify([row.source,row.account]);
      if(scopes.has(scope))return false;
      scopes.add(scope);
      if(row.source===source&&row.account===account){
        if(validRow(row,now)||row.id!==expected.id||row.kind!==expected.kind)return false;
        index=i;
      }
    }
    if(index<0)return false;
    const rows=data.rows.filter((_,i)=>i!==index);
    const next=JSON.stringify({version:1,rows});
    storage.setItem(KEY,next);
    return storage.getItem(KEY)===next&&storage.getItem(KEY)===next;
  }catch{return false}
}
