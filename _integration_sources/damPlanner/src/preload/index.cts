import { contextBridge, ipcRenderer } from 'electron';
import type { EventInput } from '../domain/models.js';

const invoke = (channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload);

const api = {
  list: () => invoke('events:list'),
  preview: (input: EventInput, id?: string) => invoke('events:preview', { input, id }),
  save: (input: EventInput, id?: string, overrideHash?: string) => invoke('events:save', { input, id, overrideHash }),
  remove: (id: string) => invoke('events:delete', id),
  retry: (id: string, provider: 'GOOGLE' | 'TWITCH') => invoke('events:retry', { id, provider }),
  publish: (id:string,overrideHash?:string)=>invoke('events:publish',{id,overrideHash}),
  hub: (start:string,end:string,refresh=false)=>invoke('hub:load',{start,end,refresh}),
  adopt: (event:unknown)=>invoke('hub:adopt',event),
  duplicate: (id:string,startAtUtc:string,endAtUtc:string)=>invoke('hub:duplicate',{id,startAtUtc,endAtUtc}),
  templates: ()=>invoke('templates:list'),
  saveTemplate: (template:unknown)=>invoke('templates:save',template),
  deleteTemplate: (id:string)=>invoke('templates:delete',id),
  cockpitData:()=>invoke('cockpit:data'),
  saveRoutine:(routine:unknown)=>invoke('routines:save',routine),
  deleteRoutine:(id:string)=>invoke('routines:delete',id),
  attachRoutine:(eventId:string,routineId:string)=>invoke('routines:attach',{eventId,routineId}),
  checkRoutine:(eventId:string,stepId:string,done:boolean)=>invoke('routines:check',{eventId,stepId,done}),
  resetRoutine:(eventId:string)=>invoke('routines:reset',eventId),
  setLifecycle:(eventId:string,state:string)=>invoke('lifecycle:set',{eventId,state}),
  completeLive:(eventId:string,actualEndAt:string,mood:string|null,note:string)=>invoke('cockpit:complete-live',{eventId,actualEndAt,mood,note}),
  savePostLive:(eventId:string,mood:string|null,note:string)=>invoke('postlive:save',{eventId,mood,note}),
  saveParticipant:(value:unknown)=>invoke('participants:save',value),
  saveTag:(value:unknown)=>invoke('tags:save',value),
  saveNetworkAction:(value:unknown)=>invoke('actions:save-network',value),
  createLocalAction:(name:string,type:'OPEN_APP'|'OPEN_FILE',enabled=true,selection:'FILE'|'DIRECTORY'='FILE')=>invoke('actions:create-local',{name,type,enabled,selection}),
  executeAction:(id:string)=>invoke('actions:execute',id),
  settings: () => invoke('settings:get'),
  updateSettings: (value: Record<string, unknown>) => invoke('settings:update', value),
  importGoogle: () => invoke('google:import'),
  connectGoogle: () => invoke('google:connect'),
  disconnectGoogle: () => invoke('google:disconnect'),
  calendars: () => invoke('google:calendars'),
  testConnections:()=>invoke('connections:test'),
  beginTwitch: () => invoke('twitch:begin'),
  completeTwitch: (state: unknown) => invoke('twitch:complete', state),
  disconnectTwitch: () => invoke('twitch:disconnect'),
  categories: (query: string) => invoke('twitch:categories', query),
  openExternal: (url: string) => invoke('external:open', url),
};

contextBridge.exposeInMainWorld('damplanner', api);

export type DamPlannerApi = typeof api;
