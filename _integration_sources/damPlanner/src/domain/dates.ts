import {DateTime} from 'luxon';
export function localRangeToUtc(date:string,start:string,end:string,timezone='Europe/Paris'){const s=DateTime.fromISO(`${date}T${start}`,{zone:timezone});let e=DateTime.fromISO(`${date}T${end}`,{zone:timezone});if(!s.isValid||!e.isValid)throw new Error('Date locale invalide');if(e<=s)e=e.plus({days:1});return {startAtUtc:s.toUTC().toISO()!,endAtUtc:e.toUTC().toISO()!};}
export function overlaps(a:{startAtUtc:string;endAtUtc:string},b:{startAtUtc:string;endAtUtc:string}){return a.startAtUtc<b.endAtUtc&&a.endAtUtc>b.startAtUtc;}
