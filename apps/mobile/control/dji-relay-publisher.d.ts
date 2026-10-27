export interface BatteryRelayPublisher {
  start(): void;
  stop(): void;
  tick(): Promise<boolean>;
  destroy(): void;
}
export interface BatteryRelayPublisherOptions {
  localRead(): Promise<unknown>;
  remoteWrite(measurement: unknown): Promise<unknown>;
  canPublish(): boolean;
  intervalMs?: number;
  now?: () => number;
  onState?: (status: 'sent' | 'unavailable') => void;
}
export function createDjiRelayPublisher(options: BatteryRelayPublisherOptions): BatteryRelayPublisher;
