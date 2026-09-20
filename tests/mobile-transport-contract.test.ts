import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('apps/mobile');
const transportSource = readFileSync(path.join(root, 'transport.js'), 'utf8');

function javascriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const full = path.join(directory, name);
    const info = statSync(full);
    if (info.isDirectory()) return name === 'shared' ? [] : javascriptFiles(full);
    return name.endsWith('.js') && name !== 'transport.js' ? [full] : [];
  });
}

describe('contrat transport de l’UI Mobile', () => {
  it('ne référence aucune méthode transport absente', () => {
    const sources = javascriptFiles(root).map(file => readFileSync(file, 'utf8')).join('\n');
    const used = [...new Set([...sources.matchAll(/\btransport\.([A-Za-z][A-Za-z0-9_]*)\s*\(/g)].map(match => match[1]))].sort();
    const declared = new Set([
      ...[...transportSource.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9_]*)\s*:/gm)].map(match => match[1]),
      ...[...transportSource.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9_]*)\s*,\s*$/gm)].map(match => match[1]),
      ...[...transportSource.matchAll(/^\s{4}(?:async\s+)?([A-Za-z][A-Za-z0-9_]*)\s*\(/gm)].map(match => match[1]),
    ]);
    expect(used.filter(name => !declared.has(name))).toEqual([]);
  });

  it('n’expose plus les full-sync providers depuis le transport de connexion Mobile', () => {
    expect(transportSource).not.toContain("'/api/v1/twitch/sync'");
    expect(transportSource).not.toContain("'/api/v1/google/sync'");
  });
});
