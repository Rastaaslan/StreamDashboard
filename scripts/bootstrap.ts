import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export type Repository = { name: string; env: string; url: string };
export type RunCommand = { manager: 'npm' | 'pnpm' | 'yarn'; args: string[] };

export const repositories: Repository[] = JSON.parse(
  await readFile(new URL('../data/repositories.json', import.meta.url), 'utf8'),
);

export async function locate(project: Repository, root = process.cwd()) {
  const configured = process.env[project.env];
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '.';
  const candidates = [configured, resolve(root, '..', project.name), resolve(home, project.name)].filter(Boolean) as string[];
  const found = candidates.find((candidate) => existsSync(resolve(candidate, 'package.json')));
  if (found) return resolve(found);

  const target = resolve(root, '.dependencies', project.name);
  await mkdir(dirname(target), { recursive: true });
  const clone = spawnSync('git', ['clone', project.url, target], { stdio: 'inherit' });
  if (clone.status) throw Error(`Clone ${project.name} impossible`);
  return target;
}

export async function command(dir: string): Promise<RunCommand> {
  const pkg = JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf8'));
  const script = ['start', 'dev', 'serve'].find((candidate) => pkg.scripts?.[candidate]);
  if (!script) throw Error(`Aucun script start/dev/serve dans ${dir}`);
  const manager = existsSync(resolve(dir, 'pnpm-lock.yaml'))
    ? 'pnpm'
    : existsSync(resolve(dir, 'yarn.lock')) ? 'yarn' : 'npm';
  return { manager, args: manager === 'npm' ? ['run', script] : [script] };
}

async function main() {
  const requested = process.argv.includes('--project')
    ? process.argv[process.argv.indexOf('--project') + 1]
    : undefined;
  const selected = requested ? repositories.filter(({ name }) => name.toLowerCase() === requested.toLowerCase()) : repositories;
  if (!selected.length) throw Error(`Projet inconnu: ${requested}`);
  for (const project of selected) {
    const dir = await locate(project);
    const run = await command(dir);
    if (process.argv.includes('--json')) console.log(JSON.stringify({ name: project.name, dir, ...run }));
    else console.log(`${project.name}: ${dir} (${run.manager} ${run.args.join(' ')})`);
    if (process.argv.includes('--start')) {
      const child = spawn(run.manager, run.args, { cwd: dir, stdio: 'ignore', shell: process.platform === 'win32', detached: true });
      child.unref();
    }
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && import.meta.url === new URL(`file://${invokedPath}`).href) await main();
