const diagnoses = {
  'no-selection':'Aucune diffusion YouTube sélectionnée.', scheduled:'Diffusion programmée.', prepared:'Diffusion préparée.',
  ingesting:'Flux reçu ; la diffusion publique n’est pas encore active.', live:'Diffusion en direct.',
  waiting:'Le chat n’est pas encore disponible pour cette diffusion.', disabled:'Le chat est désactivé pour cette diffusion.',
  ended:'Diffusion terminée. Les derniers messages restent consultables.', connected:'Chat connecté.',
  authorization:'Autorisation YouTube insuffisante ou expirée. Reconnectez le compte de cet appareil.',
  quota:'Quota YouTube atteint. La lecture reprendra après temporisation.', network:'Connexion interrompue. Les messages reçus sont conservés.',
  mismatch:'Cette diffusion n’appartient pas à la chaîne autorisée sur cet appareil.', invalid:'Réponse YouTube incomplète. Nouvelle vérification différée.',
};
function failure(error) {
  const code=error?.reason||error?.code||'',status=error?.httpStatus||error?.status;
  if (/quota|dailyLimit|rateLimit|userRequestsExceedRateLimit/i.test(code) || status===429) return 'quota';
  if (code==='liveChatDisabled') return 'disabled';
  if (code==='liveChatEnded') return 'ended';
  if (code==='liveChatNotFound') return 'waiting';
  if (/auth|permission|forbidden|REAUTH|HTTP_403/i.test(code) || status===401 || status===403) return 'authorization';
  if (code==='CHANNEL_MISMATCH'||code==='liveBroadcastNotFound') return 'mismatch';
  if (code==='invalidResponse') return 'invalid';
  return 'network';
}
/** Shared read-only lifecycle for Windows and Android. A session has exactly
 * one account/broadcast identity, one flight and one provider polling clock. */
export function createYouTubeChatReader({broadcast,messages,now=Date.now}) {
  let current,flight,nextAt=0,broadcastAt=0,chatId='',pageToken='',errors=0;
  const snapshot=()=>structuredClone({...current,nextPollAt:nextAt});
  async function read(id) {
    if (!current || current.broadcastId!==id) {
      current={broadcastId:id,channelId:'',account:'',status:id?'waiting':'no-selection',message:diagnoses[id?'waiting':'no-selection'],messages:[],broadcastState:'',ingestionStatus:null,observedAt:null};
      nextAt=0;broadcastAt=0;chatId='';pageToken='';errors=0;
    }
    if (!id) return snapshot();
    if (flight?.owner===current) return flight.promise;
    if (now()<nextAt) return snapshot();
    const owner=current;
    const update=(status,extra={})=>{Object.assign(owner,{status,message:diagnoses[status]},extra);};
    const operation=(async()=>{
      try {
        if (now()>=broadcastAt) {
          const value=await broadcast(id);
          if(owner!==current)return snapshot();
          if(value.id!==id||typeof value.channelId!=='string'||!value.channelId||typeof value.broadcastState!=='string')throw Object.assign(Error(),{code:'invalidResponse'});
          if(value.liveChatId!==chatId&&!['complete','revoked'].includes(value.broadcastState)){chatId=value.liveChatId||'';pageToken='';owner.messages=[];}
          Object.assign(owner,{channelId:value.channelId,account:value.account||value.channelId,broadcastState:value.broadcastState,ingestionStatus:value.ingestionStatus||null,observedAt:new Date(now()).toISOString()});
          broadcastAt=now()+30_000;
          if(['complete','revoked'].includes(value.broadcastState)){update('ended');nextAt=now()+60_000;return snapshot();}
          if(value.chatDisabled===true){update('disabled');nextAt=now()+60_000;return snapshot();}
        }
        const phase=owner.broadcastState==='live'?'live':owner.ingestionStatus==='active'?'ingesting':['ready','testing','testStarting','liveStarting'].includes(owner.broadcastState)?'prepared':'scheduled';
        if(!chatId){update('waiting',{phase,phaseMessage:diagnoses[phase]});nextAt=now()+30_000;return snapshot();}
        const page=await messages(chatId,pageToken);
        if(owner!==current)return snapshot();
        if(!Array.isArray(page.items)||!Number.isFinite(page.pollingIntervalMillis)||page.pollingIntervalMillis<0||(page.nextPageToken!==undefined&&typeof page.nextPageToken!=='string'))throw Object.assign(Error(),{code:'invalidResponse'});
        const received=page.items.filter(item=>typeof item.id==='string'&&typeof item.snippet?.displayMessage==='string').map(item=>({id:item.id,text:item.snippet.displayMessage.slice(0,10000),author:String(item.authorDetails?.displayName||'YouTube').slice(0,200),publishedAt:item.snippet.publishedAt||'',owner:item.authorDetails?.isChatOwner===true,moderator:item.authorDetails?.isChatModerator===true}));
        owner.messages=[...new Map([...owner.messages,...received].map(item=>[item.id,item])).values()].slice(-1000);
        pageToken=page.nextPageToken||pageToken;
        nextAt=now()+Math.max(5000,page.pollingIntervalMillis);errors=0;
        update(page.offlineAt?'ended':'connected',{phase,phaseMessage:diagnoses[phase],observedAt:new Date(now()).toISOString()});
        if(page.offlineAt){owner.broadcastState='complete';broadcastAt=0;nextAt=now()+60_000;}
      } catch(error) {
        if(owner!==current)return snapshot();
        const status=failure(error);update(status);errors++;
        nextAt=now()+(status==='quota'?300_000:status==='authorization'||status==='mismatch'?60_000:['disabled','ended'].includes(status)?60_000:Math.min(60_000,2000*2**Math.min(errors,5)));
        if(['waiting','ended','disabled'].includes(status))broadcastAt=0;
      }
      return snapshot();
    })();
    flight={owner,promise:operation};
    try{return await operation;}finally{if(flight?.promise===operation)flight=undefined;}
  }
  return {read};
}
