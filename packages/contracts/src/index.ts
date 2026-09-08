export type Mode='idle'|'intro'|'pause'|'end';
export interface StreamState {mode:Mode;running:boolean;startedAt:number|null;deadline:number|null;duration:number;remaining:number;timerVisible:boolean;previousObsScene:string|null;sequence:number;text:string;obs:{connected:boolean;currentScene:string|null;streaming:boolean}}
export interface CalendarItem {id:string;source:'DAMPLANNER'|'GOOGLE'|'TWITCH';ownership:'LOCAL'|'EXTERNAL';title:string;description?:string;startAtUtc:string;endAtUtc:string;editable:boolean;kind?:'LIVE'|'PERSONAL';draft?:boolean}
export interface CalendarPayload {rows:unknown[];warnings:string[];fetchedAt:number;fromCache:boolean;items:CalendarItem[]}
export interface ObsState {connected:boolean;streaming:boolean;scene:string|null;scenes:string[];inputs:Record<string,{muted:boolean;volume:number}>}
export interface DashboardState {at:string;streamTool:StreamState|null;planning:CalendarPayload|null;obs:ObsState;nextLive:CalendarItem|null;unscheduledLive:boolean;health:Record<string,{ok:boolean;error?:string;reconnects:number}>}
