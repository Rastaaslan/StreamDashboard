/** F02: observed held AutoMod messages from the FIXE EventSub connection.
 * Not a complete Twitch queue: events prior to subscription cannot be fetched.
 * No Twitch mutation or guessed authorization lives in this module.
 */
type RecordValue = Record<string, unknown>;
const object = (v: unknown): RecordValue =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as RecordValue : {};
const numericId = (v: unknown): v is string => typeof v === 'string' && /^\d{1,30}$/.test(v);
const messageId = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
// An EventSub hold is only a witnessed event, not proof the message is still held.
// Bound its display lifetime when an approval/denial update is missed.
const OBSERVATION_MAX_AGE_MS = 15 * 60_000;

export interface HeldAutoModMessage {
  id: string;
  broadcasterId: string;
  userId: string;
  userName: string;
  text: string;
  reason: 'automod' | 'blocked_term';
  heldAt: string;
}
export type AutomodObservation =
  | { kind: 'hold'; message: HeldAutoModMessage }
  | { kind: 'update'; broadcasterId: string; id: string; status: string };

export function parseAutomodNotification(value: unknown): AutomodObservation | null {
  const envelope = object(value), metadata = object(envelope.metadata);
  if (metadata.message_type !== 'notification' ||
      metadata.subscription_version !== '2') return null;
  const type = metadata.subscription_type;
  if (type !== 'automod.message.hold' && type !== 'automod.message.update') return null;
  const event = object(object(envelope.payload).event);
  if (!numericId(event.broadcaster_user_id) || !messageId(event.message_id)) return null;
  if (type === 'automod.message.update') {
    if (!['approved', 'denied', 'expired'].includes(String(event.status))) return null;
    return {kind:'update', broadcasterId:event.broadcaster_user_id, id:event.message_id, status:String(event.status)};
  }
  const message = object(event.message);
  if (!numericId(event.user_id) || typeof message.text !== 'string' || !message.text ||
      typeof event.held_at !== 'string' || !Number.isFinite(Date.parse(event.held_at)) ||
      !['automod','blocked_term'].includes(String(event.reason))) return null;
  return {
    kind:'hold',
    message:{
      id:event.message_id,
      broadcasterId:event.broadcaster_user_id,
      userId:event.user_id,
      userName: typeof event.user_name === 'string' ? event.user_name.slice(0,100) : '',
      text:message.text.slice(0,500),
      reason:event.reason as HeldAutoModMessage['reason'],
      heldAt:event.held_at,
    },
  };
}

/** Private, short-lived and session-bound cache. Never infer an empty Twitch queue. */
export class ObservedAutoModQueue {
  private observed = new Map<string,{message:HeldAutoModMessage;receivedAt:number}>();
  private completed = new Map<string,number>();
  private broadcasterId = '';
  private connected = false;
  private observedAt: number | null = null;
  constructor(private readonly now = Date.now) {}

  connection(status: 'CONNECTING' | 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED', broadcasterId: string) {
    if (status !== 'CONNECTED' || !numericId(broadcasterId)) {
      this.connected = false;
      this.observed.clear();
      this.completed.clear();
      this.broadcasterId = '';
      this.observedAt = null;
      return;
    }
    if (this.broadcasterId !== broadcasterId) {
      this.observed.clear();
      this.completed.clear();
      this.observedAt = null;
    }
    this.broadcasterId = broadcasterId;
    this.connected = true;
  }
  receive(notice: AutomodObservation) {
    if (!this.connected ||
      (notice.kind==='hold' ? notice.message.broadcasterId : notice.broadcasterId) !== this.broadcasterId) return false;
    const now=this.now();
    if (!Number.isFinite(now)) return false;
    for (const [id,completedAt] of this.completed) if (now-completedAt>15*60_000) this.completed.delete(id);
    if (notice.kind === 'update') {
      this.observed.delete(notice.id);
      this.completed.set(notice.id,now);
      if (this.completed.size>200) this.completed.delete(this.completed.keys().next().value!);
    } else {
      if (this.completed.has(notice.message.id)) return false;
      this.observed.delete(notice.message.id);
      this.observed.set(notice.message.id,{message:{...notice.message},receivedAt:now});
      while(this.observed.size>50) this.observed.delete(this.observed.keys().next().value!);
    }
    this.observedAt = now;
    return true;
  }
  snapshot(broadcasterId:string,allowed:boolean) {
    const available=allowed && this.connected && broadcasterId===this.broadcasterId;
    // Manual read prunes only in-memory stale observations; this never contacts
    // Twitch, changes a moderation decision, or claims an empty remote queue.
    if(available){
      const now=this.now();
      for(const [id,entry] of this.observed){
        const age=now-entry.receivedAt;
        if(!Number.isFinite(age)||age<0||age>=OBSERVATION_MAX_AGE_MS)
          this.observed.delete(id);
      }
    }
    return {
      schemaVersion:1 as const,
      kind:'streamcockpit-automod-observed' as const,
      status:available?'partial-observation' as const:'unavailable' as const,
      observedAt:available?this.observedAt:null,
      // Deliberately never expose a "complete/empty on Twitch" claim.
      messages:available?[...this.observed.values()].map(v=>({...v.message})):[],
    };
  }
}
