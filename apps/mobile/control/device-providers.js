import { callDeviceBridge } from './device-bridge.js';
import { googleRecurrence, parseGoogleRecurrence } from '../shared/planning-engine.js';

export function createDeviceProviders({bridge=globalThis.StreamDashboardProviders,request,getCalendar=()=>null,enabled=()=>true}) {
  async function call(provider,operation,payload={}) {
    if(!enabled('planning'))throw Object.assign(new Error('Le rôle Services et planning est désactivé sur cet appareil.'),{code:'DEVICE_ROLE_STOPPED',mutationNotStarted:true});
    let value;
    if(!bridge)value=await request('/api/v2/device/providers',{provider,operation,...payload});
    else {
    const methods={test:'Test',categories:'SearchCategories',calendars:'Calendars',events:'Events',read:'ReadPlanning',create:'CreatePlanning',update:'UpdatePlanning',delete:'DeletePlanning',recoverCreation:'ReconcilePlanning'};
    const method=provider+methods[operation];
    if(typeof bridge[method]!=='function')throw new Error('Mettez à jour l’application pour utiliser ce service sur cet appareil.');
    value=await callDeviceBridge(bridge,method,payload);
    }
    if(value.ok===false){const error=new Error(value.providerMessage||value.message||value.code||'Service indisponible.');error.code=value.code;error.status=Number(value.code?.match(/^HTTP_(\d+)$/)?.[1])||({REAUTH_REQUIRED:401,CONFLICT:412}[value.code]);error.remote=value.current;error.mutationNotStarted=value.nonCreation===true||value.mutationNotStarted===true;throw error;}
    return value;
  }
  const destination=async item=>{
    const selected=item.providers?.google?.calendarId||getCalendar()||'primary';
    const {items}=await call('google','calendars');
    const calendar=items.find(x=>x.id===selected||(selected==='primary'&&x.primary));
    if(!calendar||!['owner','writer'].includes(calendar.accessRole))throw Object.assign(new Error('Choisissez un calendrier accessible en écriture sur cet appareil.'),{mutationNotStarted:true});
    return {calendarId:calendar.id};
  };
  const adapters=Object.fromEntries(['twitch','google'].map(provider=>[provider,{
    prepareCreate:async item=>{
      const status=await call(provider,'test');
      if(!status.tested||!(status.capabilities||[]).includes(provider==='google'?'calendar':'schedule'))throw Object.assign(new Error('Connectez et vérifiez '+provider+' dans « Mes comptes » sur cet appareil.'),{mutationNotStarted:true});
      return provider==='google'?destination(item):{accountId:status.channelId};
    },
    read:async(id,item,options)=>{
      const result=await call(provider,'read',{event:item,link:{...item.providers?.[provider],remoteId:id,revision:item.providers?.[provider]?.remoteRevision},options});
      if(result.remote?.recurrenceLines?.length)result.remote.recurrence=parseGoogleRecurrence(result.remote);
      return result;
    },
    recoverCreation:async item=>{
      const result=await call(provider,'recoverCreation',{event:item,link:{...item.providers?.[provider],revision:item.providers?.[provider]?.remoteRevision}});
      return {id:result.remoteId||result.id,revision:result.revision,fingerprint:result.fingerprint,calendarId:result.calendarId,owned:true};
    },
    create:async item=>mutate(provider,'create',item),
    update:async(id,item,revision)=>mutate(provider,'update',item,id,revision),
    delete:async(id,item,revision)=>mutate(provider,'delete',item,id,revision),
  }]));
  async function mutate(provider,operation,item,id,revision){
    const event=structuredClone(item);
    // Materialized occurrences have already passed the shared projection checks.
    if(provider==='google'&&operation!=='delete')event.recurrenceLines=googleRecurrence({...event,seriesId:undefined,occurrenceKey:undefined});
    const result=await call(provider,operation,{event,link:{...item.providers?.[provider],...(id?{remoteId:id}:{}),revision:revision??item.providers?.[provider]?.remoteRevision}});
    return {id:result.remoteId||result.id,revision:result.revision,fingerprint:result.fingerprint,calendarId:result.calendarId,owned:result.owned!==false};
  }
  return {adapters,call};
}
