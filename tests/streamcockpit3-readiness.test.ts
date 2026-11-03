import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
// @ts-expect-error Standalone Node mjs checker intentionally has no TypeScript declaration.
import { assessStreamCockpit3 } from '../scripts/streamcockpit3-readiness.mjs';

const root = resolve(import.meta.dirname, '..');
const matrix = JSON.parse(readFileSync(resolve(root, 'docs/streamcockpit-3/feature-matrix.json'), 'utf8'));
const evaluate = (value: unknown) => assessStreamCockpit3(value);

describe('StreamCockpit 3.0 release readiness must fail closed', () => {
  it('reports actual G0/G1 and all eleven partial workstreams without certifying a build', () => {
    const result = evaluate(matrix);
    expect(result.verifiedGates).toEqual(['G0', 'G1']);
    expect(Object.values(result.featureStates)).toHaveLength(11);
    expect(result.releaseEligible).toBe(false);
    expect(result.blockers).toContain('F08_NOT_QUALIFIED');
    expect(result.blockers).toContain('G3_NOT_QUALIFIED');
    expect(result.blockers).toContain('G4_REAL_ARTIFACT_SIGNATURE_VERIFIER_MISSING');
  });

  it('refuses missing, duplicate or foreign workstreams even when G5 is manually marked qualified', () => {
    for (const corrupt of [
      { ...structuredClone(matrix), features: matrix.features.slice(1) },
      { ...structuredClone(matrix), features: [...matrix.features.slice(1), matrix.features[1]] },
      { ...structuredClone(matrix), gates: matrix.gates.slice(1) },
      null,
    ]) {
      const result = evaluate(corrupt);
      expect(result.releaseEligible).toBe(false);
      expect(result.blockers.some((s: string) => s.includes('SCOPE_INVALID') || s.includes('MATRIX_IDENTITY_INVALID'))).toBe(true);
    }
  });

  it('does not treat invented qualified statuses as verified signatures or hardware proof', () => {
    const forged = structuredClone(matrix);
    for (const f of forged.features) {
      f.status = 'qualified';
      f.hardwareEvidence = ['claimed-only'];
    }
    for (const g of forged.gates) {
      g.status = 'qualified';
      g.verifiedEvidence = ['claimed-only'];
    }
    const result = evaluate(forged);
    expect(result.sourceQualification).toBe(true);
    expect(result.verifiedGates).toHaveLength(6);
    expect(result.releaseEligible).toBe(false);
    expect(result.blockers).toContain('G4_REAL_ARTIFACT_SIGNATURE_VERIFIER_MISSING');
  });

  it('requires separate hardware evidence before even considering a feature qualified', () => {
    const partial = structuredClone(matrix);
    partial.features[0].status = 'qualified';
    partial.features[0].hardwareEvidence = [];
    expect(evaluate(partial).blockers).toContain('F00_EVIDENCE_MISSING');
  });

  it('offers a read-only status but refuses --final without real artifact verification', () => {
    const path = resolve(root, 'scripts/streamcockpit3-readiness.mjs');
    const status = spawnSync(process.execPath, [path, '--json'], {cwd: root, encoding: 'utf8'});
    expect(status.status).toBe(0);
    const result = JSON.parse(status.stdout);
    expect(result.releaseEligible).toBe(false);
    const final = spawnSync(process.execPath, [path, '--final'], {cwd: root, encoding: 'utf8'});
    expect(final.status).toBe(1);
    expect(final.stderr).toContain('STREAMCOCKPIT3_RELEASE_NOT_QUALIFIED');
  });
});

it('F10 release:check executes 3.0 fail-closed preflight before any packaging step', () => {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  expect(pkg.scripts['release:check'].startsWith('npm run streamcockpit3:release-check &&')).toBe(true);
  expect(pkg.scripts['streamcockpit3:release-check']).toBe('node scripts/streamcockpit3-readiness.mjs --final');
  expect(pkg.scripts['streamcockpit3:status']).toBe('node scripts/streamcockpit3-readiness.mjs');
});
