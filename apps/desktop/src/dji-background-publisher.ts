import { djiRelayTarget, type RelayInstallation } from '../../mobile/control/dji-relay-target.js';

interface DjiBackgroundPublisherOptions {
  topology: () => Promise<RelayInstallation>;
  localRead: () => Promise<unknown>;
  send: (host: string, measurement: unknown) => Promise<void>;
  onState?: (state: 'sent'|'error'|'no-target'|'not-connected') => void;
  intervalMs?: number;
}
/**
 * Keeps DJI battery reports flowing while the Dashboard window is minimized.
 *
 * All traffic is sent through the existing pinned TLS PeerTransport. The caller
 * resolves credentials from encrypted Windows storage; no localStorage, browser
 * tab, public route, key transfer, or new pairing is needed.
 */
export class DjiBackgroundPublisher {
  private timer: ReturnType<typeof setInterval> | undefined;
  private pending: Promise<boolean> | undefined;
  private closed = false;
  private didSendWorkingSensor = false;

  constructor(private readonly options: DjiBackgroundPublisherOptions) {}

  start() {
    if (this.timer || this.closed) return;
    void this.tick();
    this.timer=setInterval(() => { void this.tick(); }, this.options.intervalMs ?? 30_000);
  }

  stop() {
    this.closed=true;
    if (this.timer) clearInterval(this.timer);
    this.timer=undefined;
  }

  async tick(): Promise<boolean> {
    if (this.closed) return false;
    if (this.pending) return this.pending;
    const run=(async () => {
      try {
        const topology=await this.options.topology();
        if (this.closed) return false;
        const target=djiRelayTarget({installation:topology});
        if (!target) { this.options.onState?.('no-target'); return false; }
        const measurement=await this.options.localRead() as {status?:unknown}|undefined;
        if (this.closed || !measurement || !['ok','unavailable'].includes(String(measurement.status))) return false;
        // An unavailable RX is a one-time tombstone only AFTER an existing
        // working observation; don't flood the fixed PC with unneeded updates.
        if (measurement.status!=='ok' && !this.didSendWorkingSensor) return false;
        await this.options.send(target,measurement);
        if (this.closed) return false;
        this.didSendWorkingSensor=measurement.status==='ok';
        this.options.onState?.('sent');
        return true;
      }catch{
        if (!this.closed) this.options.onState?.('error');
        return false;
      }
    })();
    this.pending=run;
    try{return await run;}
    finally{if(this.pending===run)this.pending=undefined;}
  }
}
