import { createDjiBatteryWarningTracker } from '../../mobile/control/dji-battery-warnings.js';

interface DjiHostWarningWatcherOptions {
  streaming: () => boolean;
  read: () => Promise<unknown>;
  notify: (code: string) => void | Promise<void>;
  intervalMs?: number;
}
/**
 * Monitors the paired laptop's DJI data on the OBS host even when all UI
 * windows are minimized. Reads only from the local authenticated relay API;
 * it does not contact USB drivers or alter OBS output.
 */
export class DjiHostWarningWatcher {
  private timer: ReturnType<typeof setInterval>|undefined;
  private pending: Promise<void>|undefined;
  private closed=false;
  private readonly tracker=createDjiBatteryWarningTracker();
  constructor(private readonly options:DjiHostWarningWatcherOptions) {}
  start() {
    if(this.closed||this.timer)return;
    void this.tick();
    this.timer=setInterval(()=>{void this.tick();},this.options.intervalMs??10_000);
  }
  stop() {
    this.closed=true;
    if(this.timer)clearInterval(this.timer);
    this.timer=undefined;
    this.tracker.reset();
  }
  async tick():Promise<void> {
    if(this.closed)return;
    if(this.pending)return this.pending;
    const job=(async()=>{
      const live=this.options.streaming();
      if(!live){
        this.tracker.check({streaming:false,relay:null});
        return;
      }
      let relay:unknown=null;
      try {
        const source=await this.options.read() as
          {status?:unknown;observedAt?:unknown;validFrames?:unknown}|undefined;
        if(source?.status==='ok'&&typeof source.observedAt==='string') {
          relay={status:'ok',receivedAt:source.observedAt,observation:source};
        }
      }catch{ /* Lost receiver or host must never interrupt a live. */ }
      if(this.closed||!this.options.streaming())return;
      const warnings=this.tracker.check({streaming:true,relay});
      for(const warning of warnings) {
        try {await this.options.notify(warning.code);}
        catch{ /* Windows notifications are best-effort. */ }
      }
    })();
    this.pending=job;
    try{await job;}
    finally{if(this.pending===job)this.pending=undefined;}
  }
}
