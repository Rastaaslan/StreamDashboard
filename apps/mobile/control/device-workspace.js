import { newId } from './autonomy-store.js';

export const LOCAL_SCOPE = 'device-workspace-v1';
export function readDevice(storage = localStorage, mobile = false) {
  let value;
  try { value = JSON.parse(storage.getItem('sd2.device')); } catch { /* first start */ }
  return { version: 1, name: String(value?.name || (mobile ? 'Mon téléphone' : 'Mon ordinateur')).slice(0,80), role: ['stream','control','mobile'].includes(value?.role) ? value.role : mobile ? 'mobile' : 'control', configured: value?.configured === true };
}
export function saveDevice(value, storage = localStorage) {
  const name = String(value.name || '').trim();
  if (!name || name.length > 80 || !['stream','control','mobile'].includes(value.role)) throw new Error('Nom et rôle valides requis.');
  const next = {version:1,name,role:value.role,configured:true};
  storage.setItem('sd2.device', JSON.stringify(next)); return next;
}
// A fresh installation has an identity and useful data before any PC is paired.
// There is no host address, OAuth account, personal brand or implicit publication.
export function newWorkspace(device) {
  const actions = [
    ['micro','Micro','mic.toggle','','purple'],['scene-live','Jeu','mode.set','live','purple'],
    ['scene-pause','Pause','mode.set','pause','amber'],['scene-chat','Discussion','mode.set','chatting','purple'],
    ['clip-save','Sauvegarder un clip','replay.save','','green'],['scene-intro','Introduction','mode.set','intro','purple'],
  ].map(([id,label,type,value,color],i)=>({id,label,type,value,color,shortcut:`Control+Alt+Shift+F${i+1}`}));
  const settings = {streamerName:'Streamer',accent:'violet',confirmStop:true,obsUrl:'ws://127.0.0.1:4455',launchObs:false,modeScenes:{},startMode:'intro',remoteEnabled:false,streamerPingRewardIds:[]};
  return {workspace:'local:'+newId(),bundle:{savedAt:Date.now(),
    data:{configuration:{version:1,revision:0,actions,replayAutoStart:true,outputs:{twitch:{kind:'unconfigured',name:''},youtube:{kind:'unconfigured',name:''}},youtube:{clientId:'',broadcastId:'',channelId:''},metadata:{title:'',description:'',twitchGameId:'',youtubeCategoryId:'20',tags:[]}},receipts:[],metadataResults:{},
      host:{hostname:device.name,standalone:true,local:false,settings,settingsRevision:'local',planning:[],planningRevisions:{},occurrences:[],platforms:{},
        state:{mode:'idle',obs:{connected:false,streaming:false,inputs:{},scenes:[]},twitch:{connected:false},timer:{running:false,duration:300,remaining:300,deadline:null},checklist:[]}}},
    sounds:{sounds:[],available:false,currentPlayback:null},extras:{templates:[],automations:[],profile:{version:1},discord:{guildId:null,channelId:null,defaultMessage:''},google:{calendarId:null},wizebot:{commands:[],receipts:[]}},
  }};
}
