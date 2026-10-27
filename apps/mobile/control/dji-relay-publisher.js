/**
 * Send only trusted read-only DJI battery data to an explicitly selected,
 * authenticated StreamDashboard host. Never retries failed writes with queued
 * stale data and never touches the physical DJI USB device directly.
 */
export function createDjiRelayPublisher({localRead, remoteWrite, canPublish,
  intervalMs = 30_000, now = Date.now, onState = () => {}}) {
  let timer, running = false, destroyed = false, lastAttempt = 0;
  async function tick() {
    if (destroyed || running || !canPublish()) return false;
    const at = now();
    if (lastAttempt && at - lastAttempt < intervalMs - 1_000) return false;
    lastAttempt = at;
    running = true;
    try {
      const measurement = await localRead();
      if (destroyed || !canPublish()) return false;
      // Unavailable is sent as a fresh tombstone so remote UI won't display
      // an old "full" battery while the receiver is unplugged.
      if (!measurement || !['ok','unavailable'].includes(measurement.status)) return false;
      await remoteWrite(measurement);
      if (!destroyed) onState('sent');
      return true;
    } catch {
      if (!destroyed) onState('unavailable');
      return false;
    } finally {
      running = false;
    }
  }
  function start() {
    if (destroyed || timer) return;
    timer = setInterval(() => { void tick(); }, intervalMs);
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }
  function destroy() { destroyed = true; stop(); }
  return {start, stop, tick, destroy};
}
