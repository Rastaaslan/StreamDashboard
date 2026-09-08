import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const launcher = readFileSync(new URL('../scripts/Start-StreamDashboard.ps1', import.meta.url), 'utf8');

describe('launcher desktop autonome', () => {
  it('démarre OBS si nécessaire et attend le cockpit', () => {
    expect(launcher).toContain("Get-Process -Name 'obs64', 'obs32'");
    expect(launcher).toContain('Wait-Endpoint $HealthUrl');
    expect(launcher).toContain('[int]$TimeoutSeconds = 25');
  });
  it('ne lance pas les outils historiques', () => {
    expect(launcher).not.toContain("Start-Repository 'StreamTool'");
    expect(launcher).not.toContain("Start-Repository 'damPlanner'");
    expect(launcher).not.toContain('STREAMTOOL_URL');
    expect(launcher).not.toContain('DAMPLANNER_URL');
  });
  it('ouvre le navigateur seulement lorsque StreamDashboard répond', () => {
    expect(launcher).toContain('if ($status.StreamDashboard) { Start-Process $PublicUrl');
  });
});
