import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Read-only StreamCockpit 3.0 qualification preflight.
// It deliberately NEVER certifies signatures or approves an installer.
// The historic Next 2.1 universal checker has an incompatible feature matrix.
const FEATURES = Array.from({ length: 11 }, (_, i) => 'F' + String(i).padStart(2, '0'));
const GATES = Array.from({ length: 6 }, (_, i) => 'G' + i);
const VALID_FEATURE = new Set(['planned', 'partial', 'implemented', 'qualified']);
const VALID_GATE = new Set(['open', 'in_progress', 'qualified', 'blocked']);

function exactly(values, expected) {
  return Array.isArray(values) && values.length === expected.length &&
    new Set(values).size === expected.length &&
    expected.every(id => values.includes(id));
}
const evidence = value => Array.isArray(value) && value.length > 0 &&
  value.every(item => typeof item === 'string' && item.trim().length > 0);
const unique = values => Array.isArray(values) && values.every((id, i) =>
  typeof id === 'string' && values.indexOf(id) === i);

/** Pure, fail-closed assessment. A passing SOURCE preflight does not certify release bytes. */
export function assessStreamCockpit3(matrix) {
  const blockers = [];
  const project = matrix && typeof matrix === 'object' && !Array.isArray(matrix) ? matrix : {};
  const features = Array.isArray(project.features) ? project.features : [];
  const gates = Array.isArray(project.gates) ? project.gates : [];
  if (project.schemaVersion !== 1 || project.project !== 'Le StreamCockpit 3.0 Full Experience')
    blockers.push('MATRIX_IDENTITY_INVALID');
  if (!exactly(features.map(f => f?.id), FEATURES)) blockers.push('FEATURE_SCOPE_INVALID');
  if (!exactly(gates.map(g => g?.id), GATES)) blockers.push('GATE_SCOPE_INVALID');
  const featureStates = {};
  const gateStates = {};
  if (unique(features.map(f => f?.id))) {
    for (const feature of features) {
      if (!FEATURES.includes(feature.id)) continue;
      featureStates[feature.id] = VALID_FEATURE.has(feature.status) ? feature.status : 'invalid';
      if (feature.status !== 'qualified') blockers.push(feature.id + '_NOT_QUALIFIED');
      else if (!evidence(feature.verifiedTests) || !evidence(feature.hardwareEvidence))
        blockers.push(feature.id + '_EVIDENCE_MISSING');
    }
  }
  if (unique(gates.map(g => g?.id))) {
    for (const gate of gates) {
      if (!GATES.includes(gate.id)) continue;
      gateStates[gate.id] = VALID_GATE.has(gate.status) ? gate.status : 'invalid';
      if (gate.status !== 'qualified') blockers.push(gate.id + '_NOT_QUALIFIED');
      else if (!evidence(gate.verifiedEvidence)) blockers.push(gate.id + '_EVIDENCE_MISSING');
    }
  }
  // A manually edited status cannot certify unsigned or mismatched release artifacts.
  // A future G4 verifier must inspect Authenticode, Android production signer,
  // SHA-256 of both artifacts, exact source commit and tested rollback.
  blockers.push('G4_REAL_ARTIFACT_SIGNATURE_VERIFIER_MISSING');
  return {
    schemaVersion: 1,
    target: 'StreamCockpit 3.0',
    sourceQualification: Object.keys(featureStates).length === FEATURES.length &&
      FEATURES.every(id => featureStates[id] === 'qualified'),
    verifiedGates: GATES.filter(id => gateStates[id] === 'qualified'),
    featureStates, gateStates,
    releaseEligible: false,
    blockers: [...new Set(blockers)],
  };
}

async function main() {
  const source = new URL('../docs/streamcockpit-3/feature-matrix.json', import.meta.url);
  const result = assessStreamCockpit3(JSON.parse(await readFile(source, 'utf8')));
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('StreamCockpit 3.0: ' + result.verifiedGates.length + '/6 gates qualified.');
    console.log('Features qualified: ' +
      Object.values(result.featureStates).filter(status => status === 'qualified').length + '/11.');
    console.log('Release: BLOCKED (read-only preflight; no verified Windows x64/APK signatures).');
    for (const item of result.blockers) console.log(' - ' + item);
  }
  if (process.argv.includes('--final')) {
    console.error('STREAMCOCKPIT3_RELEASE_NOT_QUALIFIED: G0-G5 and independent artifact/signature checks required.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => {
    console.error('STREAMCOCKPIT3_STATUS_UNAVAILABLE: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
