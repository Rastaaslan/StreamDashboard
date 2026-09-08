import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { command, locate } from '../scripts/bootstrap.js';
import { readFileSync } from 'node:fs';

const repositories = JSON.parse(readFileSync(new URL('../data/repositories.json', import.meta.url), 'utf8'));

const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });

async function packageRepo(dir: string, scripts: Record<string, string> = { start: 'node app.js' }, lockfile?: string) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts }));
  if (lockfile) await writeFile(join(dir, lockfile), '');
}

describe('bootstrap du launcher', () => {
  it('honore un chemin configure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dashboard-'));
    const configured = join(root, 'custom');
    await packageRepo(configured);
    process.env.STREAMTOOL_PATH = configured;
    expect(await locate(repositories[0], root)).toBe(configured);
  });

  it('localise un repository frere', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dashboard-'));
    const root = join(parent, 'StreamDashboard');
    const sibling = join(parent, 'damPlanner');
    await mkdir(root);
    await packageRepo(sibling);
    delete process.env.DAMPLANNER_PATH;
    expect(await locate(repositories[1], root)).toBe(sibling);
  });

  it('reutilise un repository deja present dans .dependencies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dashboard-'));
    const dependency = join(root, '.dependencies', 'StreamTool');
    await packageRepo(dependency);
    delete process.env.STREAMTOOL_PATH;
    expect(await locate(repositories[0], root)).toBe(dependency);
  });

  it('signale clairement un dossier .dependencies incomplet', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dashboard-'));
    const dependency = join(root, '.dependencies', 'StreamTool');
    await mkdir(dependency, { recursive: true });
    delete process.env.STREAMTOOL_PATH;
    await expect(locate(repositories[0], root)).rejects.toThrow('ne contient pas de package.json valide');
  });

  it.each([
    ['package-lock.json', 'npm', ['run', 'start']],
    ['pnpm-lock.yaml', 'pnpm', ['start']],
    ['yarn.lock', 'yarn', ['start']],
  ])('detecte le gestionnaire pour %s', async (lockfile, manager, args) => {
    const dir = await mkdtemp(join(tmpdir(), 'service-'));
    await packageRepo(dir, { start: 'node app.js' }, lockfile);
    expect(await command(dir)).toEqual({ manager, args });
  });

  it('choisit dev puis serve en absence de start', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'service-'));
    await packageRepo(dir, { serve: 'vite', dev: 'tsx app.ts' });
    expect(await command(dir)).toEqual({ manager: 'npm', args: ['run', 'dev'] });
  });
});

describe('contrat PowerShell', () => {
  const launcher = readFileSync(new URL('../scripts/Start-StreamDashboard.ps1', import.meta.url), 'utf8');
  it('teste avant de lancer et attend avec un timeout borne', () => {
    expect(launcher).toContain('if (Test-Endpoint $HealthUrl) { return $true }');
    expect(launcher).toContain('[int]$TimeoutSeconds = 25');
    expect(launcher).toContain('Wait-Endpoint');
  });
  it('detache tous les processus et evite les doublons', () => {
    expect(launcher.match(/Start-Detached/g)?.length).toBeGreaterThanOrEqual(3);
    expect(launcher).toContain("Get-Process -Name 'obs64', 'obs32'");
    expect(launcher).toContain('Start-Process -FilePath');
  });
  it('valide la sortie bootstrap avant de lancer un service', () => {
    expect(launcher).toContain("le bootstrap n'a retourne aucune configuration JSON exploitable");
    expect(launcher).toContain('configuration bootstrap incomplete');
  });
  it('conserve le mode degrade et ouvre uniquement un dashboard disponible', () => {
    expect(launcher).toContain('catch { Write-Warning');
    expect(launcher).toContain('if ($status.StreamDashboard) { Start-Process $PublicUrl');
    expect(launcher).toContain('$DamPlannerUrl/api/calendar');
  });
});
