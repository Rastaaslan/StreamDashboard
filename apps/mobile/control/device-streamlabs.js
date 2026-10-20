import {normalizeStreamlabsHistory,mergeStreamlabsHistory} from '../shared/planning-engine.js';

const direct=()=>({status:'NOT_SUPPORTED',configured:false,lastError:null});
const empty=()=>({status:'NOT_CONFIGURED',configured:false,lastSyncAt:null,lastAttemptAt:null,count:0,lastError:null});
/** Native HTTP owns the widget credential. The replica keeps only normalized
 * public history, isolated by an opaque account key. No import triggers alerts. */
export function createDeviceStreamlabs({store,call,now=Date.now}){
 let account='',items=[],history=empty(),nextAttemptAt=0,backoffUntil=0;
 const key=()=>`streamlabs.history:${account}`;
 async function select(value){
  const next=value.configured&&typeof value.accountKey==='string'&&/^[a-f0-9]{64}$/.test(value.accountKey)?value.accountKey:'';
  if(value.configured&&!next)throw new Error('Identité de l’historique Streamlabs indisponible. Mettez à jour l’application.');
  if(next===account){history.configured=Boolean(next);return;}
  account=next;items=[];history=empty();nextAttemptAt=0;backoffUntil=0;
  if(!account)return;
  await store.reload();const saved=store.record.drafts[key()];
  if(saved?.items){items=mergeStreamlabsHistory([],saved.items,1000);history={...empty(),...saved.history,configured:true,count:items.length};nextAttemptAt=Number(saved.nextAttemptAt)||0;backoffUntil=Number(saved.backoffUntil)||0;}
  else history={...empty(),configured:true,status:'SYNCING'};
 }
 const snapshot=()=>({items:structuredClone(items),provider:direct(),history:structuredClone(history)});
 async function save(){if(account)await store.draft(key(),{items,history,nextAttemptAt,backoffUntil});}
 async function read(force=false){
  await select(await call({provider:'streamlabs',operation:'historyStatus'}));
  if(!account||now()<backoffUntil||(!force&&now()<nextAttemptAt))return snapshot();
  const attempt=now();history={...history,status:'SYNCING',lastAttemptAt:new Date(attempt).toISOString()};nextAttemptAt=attempt+30_000;
  try{
   const value=await call({provider:'streamlabs',operation:'historyRead'});
   // Another WebView/service instance can change the native credential while
   // this result is waiting for delivery. Do not resurrect the previous feed.
   const current=await call({provider:'streamlabs',operation:'historyStatus'});
   if(Boolean(current.configured)!==Boolean(value.configured)||current.accountKey!==value.accountKey){await select(current);return snapshot();}
   await select(value);if(!account)return snapshot();
   const data=value.data;
   if(!data||typeof data!=='object'||!['donations','subscriptions','follows','raids','bits'].some(name=>Array.isArray(data[name])))throw new Error('L’historique Streamlabs reçu est incomplet.');
   items=mergeStreamlabsHistory(items,normalizeStreamlabsHistory({data},new Date(now())),1000);
   history={status:'SYNCED',configured:true,lastAttemptAt:new Date(attempt).toISOString(),lastSyncAt:new Date(now()).toISOString(),count:items.length,lastError:null};
   nextAttemptAt=now()+30_000;backoffUntil=0;await save();
  }catch(error){
   let current;try{current=await call({provider:'streamlabs',operation:'historyStatus'});}catch{}
   if(current){const previous=account;await select(current);if(account!==previous)return snapshot();}
   history={...history,status:'ERROR',count:items.length,lastError:error.code==='HTTP_429'?'Streamlabs limite les requêtes. La synchronisation reprendra dans une minute.':error.code==='HTTP_401'||error.code==='HTTP_403'?'Streamlabs refuse cet historique. Vérifiez l’URL du widget.':'Impossible de synchroniser Streamlabs. L’historique conservé reste disponible.'};
   if(error.code==='HTTP_429')backoffUntil=now()+60_000;
   nextAttemptAt=now()+30_000;
   await save();
  }
  return snapshot();
 }
 async function route(path,body,method='GET'){
  const url=new URL(path,'http://device'),name=url.pathname;
  if(name==='/api/v1/streamlabs/events'&&method==='GET')return read(url.searchParams.get('refresh')==='1');
  if(name==='/api/v1/supports/streamlabs/history/status'&&method==='GET'){
   await select(await call({provider:'streamlabs',operation:'historyStatus'}));return structuredClone(history);
  }
  if(name==='/api/v1/supports/streamlabs/history/refresh'&&method==='POST')return (await read(true)).history;
  if(name==='/api/v1/supports/streamlabs/history/config'&&method==='PUT'){
   await select(await call({provider:'streamlabs',operation:'historyConfigure',widgetUrl:body?.widgetUrl}));
   return (await read(true)).history;
  }
  if(name==='/api/v1/supports/streamlabs/history/config'&&method==='DELETE'){
   await select(await call({provider:'streamlabs',operation:'historyClear'}));return structuredClone(history);
  }
  return undefined;
 }
 return {route};
}
