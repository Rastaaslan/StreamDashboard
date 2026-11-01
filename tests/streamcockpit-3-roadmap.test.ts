import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const matrix = JSON.parse(readFileSync(join(root, 'docs/streamcockpit-3/feature-matrix.json'), 'utf8'));
const allowed = new Set(['planned', 'partial', 'implemented', 'qualified']);
const gateStatuses = new Set(['open', 'in_progress', 'qualified', 'blocked']);
const featureIds = ['F00','F01','F02','F03','F04','F05','F06','F07','F08','F09','F10'];

describe('StreamCockpit 3.0: evidence-backed roadmap', () => {
  it('covers exactly the eleven foundational and major scope items', () => {
    expect(matrix.schemaVersion).toBe(1);
    expect(matrix.features.map((value: {id:string}) => value.id).sort()).toEqual(featureIds);
    expect(matrix.baseline.ref).toMatch(/^[a-f0-9]{40}$/);
    expect(matrix.baseline.qualification).toMatch(/NOT.*certified/i);
  });

  it('enforces unique ownership, real evidence, and a dependency DAG', () => {
    const seen = new Map<string,string[]>();
    const featureMap = new Map<string,any>(matrix.features.map((feature:any) => [feature.id,feature]));
    for (const feature of matrix.features) {
      expect(allowed.has(feature.status)).toBe(true);
      expect(['A','B','C','D'].includes(feature.lot)).toBe(true);
      expect(feature.acceptance.length).toBeGreaterThan(35);
      expect(Array.isArray(feature.verifiedTests)).toBe(true);
      expect(Array.isArray(feature.hardwareEvidence)).toBe(true);
      expect(Array.isArray(feature.blockers)).toBe(true);
      if (feature.status === 'qualified') {
        expect(feature.verifiedTests.length).toBeGreaterThan(0);
        expect(feature.hardwareEvidence.length).toBeGreaterThan(0);
      }
      for (const proof of feature.evidence) {
        expect(typeof proof.path).toBe('string');
        const file = resolve(root, proof.path);
        expect(file.startsWith(root + sep)).toBe(true);
        expect(existsSync(file)).toBe(true);
      }
      seen.set(feature.id, feature.dependsOn);
    }
    const visiting = new Set<string>(), visited = new Set<string>();
    function visit(id:string) {
      expect(featureMap.has(id)).toBe(true);
      if (visited.has(id)) return;
      expect(visiting.has(id), 'dependency cycle at ' + id).toBe(false);
      visiting.add(id);
      for (const dep of seen.get(id) || []) visit(dep);
      visiting.delete(id);visited.add(id);
    }
    for (const id of seen.keys()) visit(id);
  });

  it('cannot mark delivery as qualified without all ten workstreams plus foundation', () => {
    expect(matrix.gates.map((g:any) => g.id)).toEqual(['G0','G1','G2','G3','G4','G5']);
    for (const gate of matrix.gates) {
      expect(gateStatuses.has(gate.status)).toBe(true);
      if (gate.status === 'qualified') expect(gate.verifiedEvidence.length).toBeGreaterThan(0);
    }
    const allQualified = matrix.features.every((feature:any) => feature.status === 'qualified');
    const delivery = matrix.gates.find((g:any) => g.id === 'G5');
    if (!allQualified) expect(delivery.status).not.toBe('qualified');
  });
});
