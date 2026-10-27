import type { AgentObservation } from '../../../packages/contracts/src/agent-v2.js';
/**
 * Experimental dependency-injected OBS observer, independent of Electron.
 * No socket server, no OBS mutation, no persisted secrets and no process launched.
 */
export interface ObsReadOnlyClient {
  call(kind: 'GetStats'): Promise<unknown>;
  call(kind: 'GetStreamStatus'): Promise<unknown>;
}
export interface ObsHealth {
  connected: true;
  active: boolean;
  outputBytes: number | null;
  skippedFrames: number | null;
  renderedFrames: number | null;
}
export function requireLoopbackObsUrl(input: string): string {
  let url: URL;
  try { url=new URL(input); }
  catch { throw new Error('Invalid OBS WebSocket URL'); }
  if(url.protocol!=='ws:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname.toLowerCase())
    || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname!=='/'))
    throw new Error('OBS observer requires an unauthenticated URL on loopback only');
  return url.href;
}
const numberOrNull=(value: unknown): number|null =>
  typeof value==='number' && Number.isFinite(value) && value>=0 ? value:null;
export async function observeObsHealth(client: ObsReadOnlyClient, deviceId: string,
  revision: number, now: number): Promise<AgentObservation<ObsHealth>> {
  if(!/^[A-Za-z0-9_-]{1,96}$/.test(deviceId)||!Number.isSafeInteger(revision)||revision<0||!Number.isFinite(now))
    throw new Error('Invalid OBS observation metadata');
  const [statsRaw, streamRaw]=await Promise.all([client.call('GetStats'),client.call('GetStreamStatus')]);
  const stats=statsRaw as Record<string,unknown>,stream=streamRaw as Record<string,unknown>;
  if(!stats || !stream || typeof stream.outputActive!=='boolean') throw new Error('Invalid OBS status');
  return {sourceDeviceId:deviceId,revision,observedAt:now,staleAt:now+8000,payload:{
    connected:true,active:stream.outputActive,
    outputBytes:numberOrNull(stream.outputBytes),
    skippedFrames:numberOrNull(stats.outputSkippedFrames),
    renderedFrames:numberOrNull(stats.renderTotalFrames),
  }};
}
