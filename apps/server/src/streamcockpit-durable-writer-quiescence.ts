/**
 * F10 preparation: one-FIXE-process maintenance barrier for the three reviewed
 * SQLite writer interfaces. This does NOT protect other processes, raw writer
 * references or the rest of the StreamCockpit durable stores. It never pauses
 * OBS, Twitch, an installed server, or a Windows service.
 *
 * A rejected writer is conservatively considered uncertain. The coordinator
 * remains blocked for operator-controlled recovery; it NEVER silently retries
 * a provider action or re-opens writes after an incomplete maintenance pass.
 */
type JournalDomain='automod'|'prediction'|'moments'|'mixer';
type Phase='active'|'draining'|'quiesced'|'blocked';
const policies:Record<JournalDomain,{mutation:readonly string[];readonly:readonly string[]}> = {
  automod:{mutation:['reserve'],readonly:['isBlocked']},
  mixer:{mutation:['reserve','complete'],readonly:['read','history']},
  prediction:{
    mutation:['reserve','releaseBeforePost','recordConfirmed','releaseConfirmedTerminal',
      'markLockAttempted','markEndAttempted'],
    readonly:['isBlocked','readConfirmedId','readLockAttempted','readEndAttempted'],
  },
  moments:{mutation:['compareAndSwap'],readonly:['read']},
};
const issue=(code:string)=>new Error('SC3_DURABLE_WRITERS_'+code);

export class HostDurableWriterQuiescence {
  private phase:Phase='active';
  private active=0;
  private failed=false;
  private readonly domains=new Set<JournalDomain>();
  private readonly draining:Array<()=>void>=[];

  get status(){return {phase:this.phase,active:this.active,coverage:[...this.domains].sort()};}

  /** A single owned instance per journal. Never retain the unwrapped writer. */
  protect<T extends object>(domain:JournalDomain,writer:T):T{
    if(this.phase!=='active'||this.domains.has(domain))throw issue('REGISTRATION_DENIED');
    if(!writer||typeof writer!=='object')throw issue('REGISTRATION_DENIED');
    const policy=policies[domain];
    for(const name of policy.mutation)
      if(typeof Reflect.get(writer,name,writer)!=='function')throw issue('INCOMPLETE_WRITER');
    const mutation=new Set<string>(policy.mutation),readonly=new Set<string>(policy.readonly);
    this.domains.add(domain);
    return new Proxy(writer,{
      get:(target,key)=>{
        const value=Reflect.get(target,key,target);
        if(typeof value!=='function')return value;
        if(typeof key!=='string'||(!mutation.has(key)&&!readonly.has(key)))
          return ()=>{throw issue('UNREVIEWED_METHOD')};
        if(!mutation.has(key))return value.bind(target);
        return (...args:unknown[])=>this.record(()=>value.apply(target,args));
      },
    });
  }

  private finish(failed:boolean){
    this.active--;
    if(failed){
      this.failed=true;
      // An uncertain SQLite COMMIT must prevent later maintenance or writes.
      if(this.phase==='active')this.phase='blocked';
    }
    if(this.active===0)for(const resolve of this.draining.splice(0))resolve();
  }
  private record<T>(operation:()=>T):T{
    if(this.phase!=='active'||this.failed)throw issue('PAUSED_OR_BLOCKED');
    this.active++;
    try{
      const result=operation();
      if(result!==null&&(typeof result==='object'||typeof result==='function')&&
        typeof (result as {then?:unknown}).then==='function')
        return Promise.resolve(result).then(
          value=>{this.finish(false);return value;},
          error=>{this.finish(true);throw error},
        ) as T;
      this.finish(false);
      return result;
    }catch(error){this.finish(true);throw error}
  }

  /** Maintenance begins only after all known in-process writes have settled.
   * No new journal mutations may enter during draining or maintenance.
   * Any write failure or maintenance failure permanently blocks this instance;
   * callers must NOT silently create a new one to bypass that decision.
   */
  async withQuiesced<T>(operation:()=>T|Promise<T>):Promise<T>{
    if(this.phase!=='active'||this.failed)throw issue('MAINTENANCE_UNAVAILABLE');
    if(!(['automod','prediction','moments']as const).every(d=>this.domains.has(d)))
      throw issue('COVERAGE_INCOMPLETE');
    this.phase='draining';
    if(this.active>0)await new Promise<void>(resolve=>this.draining.push(resolve));
    if(this.failed){this.phase='blocked';throw issue('WRITER_OUTCOME_UNCERTAIN')}
    this.phase='quiesced';
    try{
      const result=await operation();
      this.phase='active';
      return result;
    }catch(error){
      this.phase='blocked';
      throw error;
    }
  }
  assertQuiesced(){
    if(this.phase!=='quiesced'||this.active!==0||this.failed)
      throw issue('NOT_QUIESCED');
  }
}
