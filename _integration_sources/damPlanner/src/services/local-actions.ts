import { spawn as nodeSpawn } from 'node:child_process';
import type { LocalActionTarget } from '../domain/models.js';

export type ActionExecutionResult = { ok: true; status?: number };

export type ActionAdapters = {
  spawn: typeof nodeSpawn;
  openPath(path: string): Promise<string>;
  openExternal(url: string): Promise<void>;
  fetch(input: string, init: RequestInit): Promise<Response>;
};

const defaults: ActionAdapters = {
  spawn: nodeSpawn,
  openPath: async path => {
    const { shell } = await import('electron');
    return shell.openPath(path);
  },
  openExternal: async url => {
    const { shell } = await import('electron');
    await shell.openExternal(url);
  },
  fetch,
};

export function assertSafeTarget(target: LocalActionTarget) {
  if (target.type === 'OPEN_URL') {
    const url = new URL(target.url);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Protocole URL interdit');
    }
  }

  if (target.type === 'LOCAL_HTTP') {
    const url = new URL(target.url);
    if (
      !['http:', 'https:'].includes(url.protocol)
      || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
    ) {
      throw new Error('LOCAL_HTTP est limité à localhost');
    }
  }

  if (
    (target.type === 'OPEN_APP' || target.type === 'OPEN_FILE')
    && (target.path.includes(String.fromCharCode(0)) || !target.path.trim())
  ) {
    throw new Error('Chemin invalide');
  }

  return target;
}

export async function executeLocalAction(
  target: LocalActionTarget,
  adapters: ActionAdapters = defaults,
): Promise<ActionExecutionResult> {
  assertSafeTarget(target);
  if (!target.enabled) throw new Error('Action désactivée');

  if (target.type === 'OPEN_APP') {
    await new Promise<void>((resolve, reject) => {
      const child = adapters.spawn(target.path, [], {
        detached: true,
        stdio: 'ignore',
        shell: false,
        windowsHide: false,
      });

      child.once('spawn', () => {
        child.unref();
        resolve();
      });
      child.once('error', error => {
        reject(new Error(`Impossible d’ouvrir ${target.name} : ${error.message}`));
      });
    });
    return { ok: true };
  }

  if (target.type === 'OPEN_FILE') {
    const error = await adapters.openPath(target.path);
    if (error) throw new Error(`Impossible d’ouvrir ${target.name} : ${error}`);
    return { ok: true };
  }

  if (target.type === 'OPEN_URL') {
    await adapters.openExternal(target.url);
    return { ok: true };
  }

  const response = await adapters.fetch(target.url, {
    method: target.method,
    redirect: 'manual',
    signal: AbortSignal.timeout(3000),
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error('Redirection LOCAL_HTTP interdite');
  }
  if (!response.ok) {
    throw new Error(`Intégration locale indisponible (${response.status})`);
  }
  return { ok: true, status: response.status };
}
