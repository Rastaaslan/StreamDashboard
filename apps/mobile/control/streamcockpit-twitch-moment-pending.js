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
function store(view){try{return view?.localStorage}catch{return undefined}}
function read(storage,now){
  const raw=storage.getItem(KEY);
  if(raw===null)return [];
  if(raw.length>8192)throw Error('OVER_LIMIT');
  const data=JSON.parse(raw);
  if(data?.version!==1||!Array.isArray(data.rows)||data.rows.length>MAX_RECORDS)throw Error('BAD_STORAGE');
  const scopes=new Set();
  for(const row of data.rows){
    if(!safeRow(row,now))throw Error('BAD_ROW');
    const scope=JSON.stringify([row.source,row.account]);
    if(scopes.has(scope))throw Error('DUPLICATE_SCOPE');
    scopes.add(scope);
  }
  return data.rows.filter(r=>validRow(r,now)); // Expired hints obey the explicit 7-day retention policy.
}
function write(storage,rows){storage.setItem(KEY,JSON.stringify({version:1,rows}));}
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
    write(storage,rows);
    return loadUncertainMoment(view,source,account,now)?.id===receipt.id;
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
    write(storage,rows);
    return loadUncertainMoment(view,source,account,now)===null;
  }catch{return false}
}
