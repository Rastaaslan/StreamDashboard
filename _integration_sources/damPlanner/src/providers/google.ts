import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { shell } from 'electron';
import { DateTime } from 'luxon';
import type { PlannerEvent } from '../domain/models.js';
import { AuthenticatedFetch, jsonOrError, type OAuthTokens } from '../oauth/authenticated-fetch.js';
import type { SecureTokenStore } from '../oauth/token-store.js';
import type { CalendarProvider, RemoteSlot } from './contracts.js';
import { ReauthRequiredError } from './contracts.js';

interface GoogleCredentials { clientId: string; clientSecret: string }
interface GoogleEvent { id: string; summary?: string; description?:string; colorId?:string; recurringEventId?:string; start: { dateTime?: string;date?:string;timeZone?:string }; end: { dateTime?: string;date?:string;timeZone?:string }; extendedProperties?: { private?: { damplannerEventId?: string } } }
const scopes = ['https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.freebusy'];

export class GoogleCalendarProvider extends AuthenticatedFetch implements CalendarProvider {
  constructor(store: SecureTokenStore, private readonly credentials: () => Promise<GoogleCredentials | null>) { super(store, 'google-tokens'); }
  async configured() { return Boolean(await this.credentials()); }
  async connected() { try { await this.readTokens(); return true; } catch { return false; } }
  async disconnect() { await this.clearTokens(); }
  async connect(): Promise<void> {
    const credentials = await this.credentials();
    if (!credentials) throw new Error('Google non configuré');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(24).toString('hex');
    const { code, redirectUri } = await new Promise<{code:string;redirectUri:string}>((resolve, reject) => {
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.searchParams.get('state') !== state || !url.searchParams.get('code')) { response.statusCode=400; response.end('Échec OAuth'); return; }
        response.end('<meta charset="utf-8"><h1>DamPlanner connecté</h1><p>Vous pouvez fermer cette fenêtre.</p>');
        resolve({ code: url.searchParams.get('code')!, redirectUri: `http://127.0.0.1:${(server.address() as {port:number}).port}/oauth/google` });
        server.close();
      }).listen(0, '127.0.0.1', async () => {
        const redirectUri=`http://127.0.0.1:${(server.address() as {port:number}).port}/oauth/google`;
        const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
        Object.entries({client_id:credentials.clientId,redirect_uri:redirectUri,response_type:'code',scope:scopes.join(' '),access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'}).forEach(([k,v])=>url.searchParams.set(k,v));
        try { await shell.openExternal(url.toString()); } catch (error) { server.close(); reject(error); }
      });
      server.on('error', reject); setTimeout(()=>{server.close();reject(new Error('Délai OAuth Google dépassé'));}, 180_000);
    });
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:credentials.clientId,client_secret:credentials.clientSecret,redirect_uri:redirectUri,grant_type:'authorization_code',code_verifier:verifier})});
    const token=await jsonOrError<{access_token:string;refresh_token?:string;expires_in:number}>(response);
    await this.writeTokens({accessToken:token.access_token,refreshToken:token.refresh_token,expiresAt:Date.now()+token.expires_in*1000});
  }
  protected async refresh(value: OAuthTokens) {
    const c=await this.credentials(); if(!c||!value.refreshToken){await this.clearTokens();throw new ReauthRequiredError('Reconnexion Google requise');}
    const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.clientId,client_secret:c.clientSecret,refresh_token:value.refreshToken,grant_type:'refresh_token'})});
    if(!r.ok){await this.clearTokens();throw new ReauthRequiredError('Jeton Google révoqué');}const t=await r.json() as {access_token:string;expires_in:number};const next={...value,accessToken:t.access_token,expiresAt:Date.now()+t.expires_in*1000};await this.writeTokens(next);return next;
  }
  async calendars(){const r=await this.authorized('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250');return (await jsonOrError<{items:{id:string;summary:string;primary?:boolean;backgroundColor?:string;foregroundColor?:string;timeZone?:string}[]}>(r)).items??[];}
  async listEvents(calendarId:string,start:string,end:string,calendarName?:string,color?:string){const url=`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&showDeleted=false&orderBy=startTime&maxResults=2500&timeMin=${encodeURIComponent(start)}&timeMax=${encodeURIComponent(end)}`;const data=await jsonOrError<{items?:GoogleEvent[];timeZone?:string}>(await this.authorized(url));const zone=data.timeZone??'UTC';return(data.items??[]).flatMap(x=>{const allDay=Boolean(x.start.date&&x.end.date),from=x.start.dateTime??(x.start.date?DateTime.fromISO(x.start.date,{zone}).toUTC().toISO():null),to=x.end.dateTime??(x.end.date?DateTime.fromISO(x.end.date,{zone}).toUTC().toISO():null);return from&&to?[{id:x.id,title:x.summary??'Occupé (Google)',description:x.description,startAtUtc:from,endAtUtc:to,allDay,calendarId,calendarName,color,recurringEventId:x.recurringEventId,damplannerEventId:x.extendedProperties?.private?.damplannerEventId}]:[]});}
  async events(start:string,end:string,calendarIds:string[]){const calendars=await this.calendars(),byId=new Map(calendars.map(x=>[x.id,x])),items:RemoteSlot[]=[],warnings:string[]=[];await Promise.all(calendarIds.map(async id=>{try{const c=byId.get(id);items.push(...await this.listEvents(id,start,end,c?.summary,c?.backgroundColor))}catch(error){warnings.push(`${byId.get(id)?.summary??id} n’a pas pu être actualisé : ${error instanceof Error?error.message:'erreur Google'}`)}}));return{items,warnings}}
  async availability(start:string,end:string,calendarIds:string[]){const r=await this.authorized('https://www.googleapis.com/calendar/v3/freeBusy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({timeMin:start,timeMax:end,items:calendarIds.map(id=>({id}))})});const data=await jsonOrError<{calendars:Record<string,{busy:{start:string;end:string}[];errors?:unknown[]}>}>(r);const slots:RemoteSlot[]=[];for(const[id,c]of Object.entries(data.calendars)){if(c.errors?.length)continue;const events=await this.listEvents(id,start,end);if(events.length)slots.push(...events);else for(const b of c.busy)slots.push({id:`${id}:${b.start}`,title:'Occupé (Google)',startAtUtc:b.start,endAtUtc:b.end,calendarId:id});}return slots;}
  private eventId(id:string){return `dp${id.replaceAll('-','').toLowerCase()}`;}
  private payload(e:PlannerEvent){return {id:this.eventId(e.id),summary:e.title,description:e.description,start:{dateTime:e.startAtUtc,timeZone:e.timezone},end:{dateTime:e.endAtUtc,timeZone:e.timezone},extendedProperties:{private:{damplannerEventId:e.id}}};}
  async create(e:PlannerEvent){const raw=e.googleCalendarId??'primary',calendar=encodeURIComponent(raw),id=this.eventId(e.id);const existing=await this.getFrom(calendar,id);if(!existing)await jsonOrError(await this.authorized(`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(this.payload(e))}));return `${raw}|${id}`;}
  private external(value:string){const split=value.indexOf('|');return split<0?{calendar:'primary',id:value}:{calendar:value.slice(0,split),id:value.slice(split+1)};}
  async update(external:string,e:PlannerEvent){const x=this.external(external);await jsonOrError(await this.authorized(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(x.calendar)}/events/${x.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...this.payload(e),id:x.id})}));}
  async delete(external:string){const x=this.external(external);const response=await this.authorized(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(x.calendar)}/events/${x.id}`,{method:'DELETE'});if(response.status!==404)await jsonOrError(response);}
  private async getFrom(calendar:string,id:string){const r=await this.authorized(`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events/${id}`);if(r.status===404)return undefined;return jsonOrError<GoogleEvent>(r);}
  async get(external:string){const e=this.external(external),x=await this.getFrom(encodeURIComponent(e.calendar),e.id);if(!x)return;const zone=x.start.timeZone??'UTC',start=x.start.dateTime??(x.start.date?DateTime.fromISO(x.start.date,{zone}).toUTC().toISO():null),end=x.end.dateTime??(x.end.date?DateTime.fromISO(x.end.date,{zone}).toUTC().toISO():null);return start&&end?{id:x.id,title:x.summary??'',description:x.description,startAtUtc:start,endAtUtc:end,allDay:Boolean(x.start.date),calendarId:e.calendar,damplannerEventId:x.extendedProperties?.private?.damplannerEventId}:undefined;}
}
