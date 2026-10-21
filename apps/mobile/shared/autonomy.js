// Shared JSON model: executable commands and secrets are deliberately not resources.
export const fields = {
 planning:['title','description','startAtUtc','endAtUtc','category','allDay','twitchCategoryId','twitchCategoryName','tags','tagPreferences','desiredPublication','recurrence'],
 settings:['streamerName','accent','confirmStop','obsUrl','launchObs','obsExecutablePath','modeScenes','chattingScene','startMode','timerBrowserSource','primaryMicInput','requireTimerOverlayOnStart','remoteEnabled','streamerPingRewardIds','tagPreferences'],
 sound:['name','favorite','volume','enabled','cooldownMs','category','monitoringMode','outputId'],
 automation:['name','enabled','trigger','conditions','actions','cooldownMs'],
 template:['title','description','twitchCategoryId','twitchCategoryName','desiredPublication','tags','tagPreferences'],
};
export const clone = value => value === undefined ? undefined : structuredClone(value);
export const pick = (value, keys) => Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,clone(value[k])]));
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export function equal(a,b){if(a===b)return true;if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>equal(v,b[i]));if(object(a)&&object(b)){const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));}return false;}
export function safeJSON(value){if(Array.isArray(value))return value.every(safeJSON);if(object(value))return Object.entries(value).every(([k,v])=>!['__proto__','prototype','constructor'].includes(k)&&safeJSON(v));return value===null||['string','number','boolean'].includes(typeof value);}
// A delete versus an edit is a conflict; different object fields can merge.
export function merge(base, local, remote, path=''){
 if(equal(local,base))return {value:clone(remote),conflicts:[]};
 if(equal(remote,base)||equal(local,remote))return {value:clone(local),conflicts:[]};
 if(object(base)&&object(local)&&object(remote)){
  const value={},conflicts=[];
  for(const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){
   const result=merge(base[key],local[key],remote[key],path?path+'.'+key:key);
   if(result.value!==undefined)value[key]=result.value;conflicts.push(...result.conflicts);
  }
  return {value,conflicts};
 }
 return {value:clone(local),conflicts:[path||'élément']};
}
export function resources(bundle){
 const {data,extras={},sounds={sounds:[]}}=bundle,c=data.configuration,h=data.host,result={};
 result['settings/root']=pick(h.settings,fields.settings);
 for(const action of c.actions)result['action/'+action.id]=clone(action);
 for(const platform of ['twitch','youtube'])result['output/'+platform]=clone(c.outputs[platform]);
 result['youtube/root']=clone(c.youtube);result['preferences/root']={replayAutoStart:c.replayAutoStart!==false};
 for(const item of h.planning)result['planning/'+item.id]=pick(item,fields.planning);
 for(const item of extras.templates||[])result['template/'+item.id]=pick(item,fields.template);
 for(const item of extras.automations||[])result['automation/'+item.id]=pick(item,fields.automation);
 for(const item of sounds.sounds||[])result['sound/'+item.id]=pick(item,fields.sound);
 if(extras.profile)result['profile/root']=clone(extras.profile);
 if(extras.discord)result['discord/root']=pick(extras.discord,['guildId','channelId','defaultMessage']);
 if(extras.google)result['google/root']=clone(extras.google);
 return result;
}
export function overlay(bundle, edits){
 const result=clone(bundle),{data,extras}=result,c=data.configuration,h=data.host;
 const put=(list,id,value)=>{const i=list.findIndex(x=>x.id===id);if(value===null){if(i>=0)list.splice(i,1);}else if(i>=0)list[i]={...list[i],...clone(value),id};else list.push({id,...clone(value)});};
 for(const [key,value] of Object.entries(edits)){
  const [kind,id]=key.split('/');
  if(kind==='planning'){put(h.planning,id,value===null?null:{ownership:'LOCAL',editable:true,...value});h.planningRevisions[id]='local';}
  if(kind==='action')put(c.actions,id,value);
  if(kind==='template')put(extras.templates,id,value);
  if(kind==='automation')put(extras.automations,id,value);
  if(kind==='sound')put(result.sounds.sounds,id,value);
  if(kind==='settings')Object.assign(h.settings,clone(value));
  if(kind==='output')c.outputs[id]=clone(value);
  if(kind==='youtube')c.youtube=clone(value);
  if(kind==='preferences')Object.assign(c,clone(value));
  if(kind==='profile')extras.profile=clone(value);
  if(kind==='discord')extras.discord=clone(value);
  if(kind==='google')extras.google=clone(value);
 }
 return result;
}
