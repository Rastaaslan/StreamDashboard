import {describe, expect, it, vi} from 'vitest';
import {diagnoseHealth, reconcileHealthAlerts, sources, type HealthSnapshot, type Source} from '../packages/core/src/streamcockpit-health/index.js';
const now = 100_000;
function snapshot(): HealthSnapshot {
  return {hostId: 'fixe', observations: Object.fromEntries(sources.map(source => [source,
    {provenance: `agent/${source}`, observedAt: now, receivedAt: now, data: source === 'micro' ? {available:true, muted:false, levelDb:-Infinity}
      : source === 'dji' ? {batteryPercent:65} : source === 'sync' ? {offsetMs:0} : {connected:true}}]))};
}
const get = (s: unknown, source: Source, at = now) => diagnoseHealth(s, at).diagnostics.find(d => d.source === source)!;
describe('Lot A pure offline health', () => {
  it('is deterministic and does not mutate input; silence is healthy with explicit device evidence', () => {
    const s = snapshot(), original = structuredClone(s);
    expect(diagnoseHealth(s, now)).toEqual(diagnoseHealth(s, now));
    expect(diagnoseHealth(s, now).status).toBe('healthy');
    expect(s).toEqual(original);
  });
  it('missing telemetry and missing provenance remain unknown', () => {
    expect(diagnoseHealth(null, now).diagnostics.every(d => d.status === 'unknown')).toBe(true);
    const s = snapshot(); delete s.observations.obs;
    expect(get(s, 'obs').status).toBe('unknown');
    expect(diagnoseHealth(s, now).status).toBe('unknown');
    s.observations.twitch!.provenance = '';
    expect(get(s, 'twitch').freshness).toBe('invalid');
  });
  it('offline host suppresses cached downstream health; reconnect needs fresh evidence', () => {
    const s = snapshot(); s.observations.host!.data.connected = false;
    expect(get(s, 'host').status).toBe('critical');
    expect(get(s, 'obs').status).toBe('unknown');
    expect(get(s, 'dji').batteryPercent).toBeUndefined();
    s.observations.host!.data.connected = true;
    s.observations.host!.observedAt = s.observations.host!.receivedAt = now + 20_000;
    expect(get(s, 'obs', now + 20_000).freshness).toBe('stale');
    s.observations.obs!.observedAt = s.observations.obs!.receivedAt = now + 20_000;
    expect(get(s, 'obs', now + 20_000).status).toBe('healthy');
  });
  it('rejects future observations, future receipt and backwards clocks; old observations cannot be refreshed by receipt', () => {
    const s = snapshot();
    for (const key of ['observedAt', 'receivedAt'] as const) {
      s.observations.obs![key] = now + 3000;
      expect(get(s, 'obs').freshness).toBe('clock-skew');
      s.observations.obs![key] = now;
    }
    expect(get(s, 'host', now - 3000).freshness).toBe('clock-skew');
    s.observations.obs!.observedAt = now - 16000;
    expect(get(s, 'obs').freshness).toBe('stale');
    expect(() => diagnoseHealth(s, NaN)).toThrow('INVALID_HEALTH_CLOCK');
  });
  it.each([undefined, -1, 101, NaN, Infinity, '40'])('never invents battery from %s', battery => {
    const s = snapshot(); s.observations.dji!.data = {batteryPercent:battery as number};
    expect(get(s, 'dji').status).toBe('unknown'); expect(get(s, 'dji').batteryPercent).toBeUndefined();
  });
  it('uses explicit microphone failure, mute, battery and sync measurements', () => {
    const s = snapshot(); s.observations.micro!.data = {levelDb:-100};
    expect(get(s, 'micro').status).toBe('unknown');
    s.observations.micro!.data = {available:false}; expect(get(s, 'micro').status).toBe('critical');
    s.observations.micro!.data = {available:true, muted:true}; expect(get(s, 'micro').status).toBe('degraded');
    s.observations.dji!.data.batteryPercent = 0; expect(get(s, 'dji').batteryPercent).toBe(0);
    expect(get(s, 'dji').status).toBe('critical');
    s.observations.sync!.data.offsetMs = -250; expect(get(s, 'sync').status).toBe('degraded');
    s.observations.sync!.data.offsetMs = 2000; expect(get(s, 'sync').status).toBe('critical');
  });
  it('deduplicates through missing telemetry; resolves on recovery and alerts on reappearance', () => {
    const s = snapshot(); s.observations.obs!.data.connected = false;
    const a = reconcileHealthAlerts(diagnoseHealth(s, now)); expect(a.opened).toHaveLength(1);
    const b = reconcileHealthAlerts(diagnoseHealth(s, now + 1), a.state); expect(b.opened).toHaveLength(0);
    const missing = structuredClone(s); delete missing.observations.obs;
    const c = reconcileHealthAlerts(diagnoseHealth(missing, now), b.state);
    expect(c.resolved).toHaveLength(0); expect(c.state.pending).toHaveLength(1);
    expect(reconcileHealthAlerts(diagnoseHealth(s, now), c.state).opened).toHaveLength(0);
    const d = reconcileHealthAlerts(diagnoseHealth(snapshot(), now), c.state); expect(d.resolved).toHaveLength(1);
    expect(reconcileHealthAlerts(diagnoseHealth(s, now), d.state).opened).toHaveLength(1);
    s.hostId = 'other'; expect(reconcileHealthAlerts(diagnoseHealth(s, now), a.state).opened).toHaveLength(1);
  });
});

// Minimal DOM contract fixture, not a browser/device qualification.
class Element {
  ownerDocument = {createElement: () => new Element()};
  children: Element[] = []; dataset: Record<string,string> = {}; textContent = ''; className = ''; removed = false;
  setAttribute() {} append(...children: Element[]) { this.children.push(...children); }
  replaceChildren() { this.children = []; } remove() { this.removed = true; }
}
it('mobile renders safe text, measured battery, expiry and teardown', async () => {
  // @ts-expect-error Browser JS module intentionally has no declaration file.
  const {mountStreamCockpitHealth} = await import('../apps/mobile/control/streamcockpit-health/index.js');
  vi.useFakeTimers();
  try {
    const root = new Element(), component = mountStreamCockpitHealth(root);
    const panel = root.children[0], summary = panel.children[1], list = panel.children[2];
    expect(summary.textContent).toContain('Inconnu');
    const s = snapshot(); s.observations.dji!.provenance = '<img onerror=bad>';
    component.update(diagnoseHealth(s, now));
    expect(list.children[4].textContent).toContain('65 % mesurés');
    expect(list.children[4].textContent).toContain('<img onerror=bad>');
    vi.advanceTimersByTime(15000); expect(summary.textContent).toContain('Inconnu');
    component.update(diagnoseHealth(s, now)); component.unavailable(); expect(list.children).toHaveLength(0);
    component.destroy(); component.update(diagnoseHealth(s, now)); expect(panel.removed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
