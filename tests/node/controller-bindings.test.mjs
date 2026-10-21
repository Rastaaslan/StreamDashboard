import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createControllerBindings, isTemporaryControllerFailure, controllerConfigurationError } from '../../apps/mobile/control/controller-bindings.js';

const context = { server: 'http://100.126.186.44:48133', credential: 'synthetic-device-credential' };
const actions = [{ id: 'scene-live', type: 'mode.set', value: 'live', shortcut: 'Control+Alt+Shift+F2' }];

test('cached or local actions cannot arm native keys before a successful synchronization', () => {
  const configure = createControllerBindings();
  assert.deepEqual(configure({ ...context, actions }).actions, []);
  assert.deepEqual(configure({ ...context, actions, synchronized: true }).actions, actions);
});

test('one failed refresh preserves the last confirmed bindings without needing another renderer poll', () => {
  const configure = createControllerBindings();
  const first = configure({ ...context, actions, synchronized: true });
  const duringOutage = configure({ ...context, actions: [{ ...actions[0], id: 'unconfirmed-local-edit' }] });
  // The native process keeps these mappings even if the renderer stops here.
  assert.deepEqual(duringOutage, first);
  first.actions[0].id = 'changed-by-consumer';
  assert.deepEqual(configure({ ...context }).actions, actions);
});

test('source and identity changes retire the old bindings until the new source is synchronized', () => {
  for (const changed of [{ server: 'http://192.168.1.9:48133' }, { credential: 'replacement-credential' }]) {
    const configure = createControllerBindings();
    configure({ ...context, actions, synchronized: true });
    assert.deepEqual(configure({ ...context, ...changed, actions }).actions, []);
    assert.deepEqual(configure({ ...context, actions }).actions, [], 'Returning to an old source must not resurrect retired keys');
    assert.deepEqual(configure({ ...context, ...changed, actions, synchronized: true }).actions, actions);
  }
});

test('local workspace and blocked edits invalidate confirmed actions rather than arming the edited view', () => {
  for (const changed of [{ server: '' }, { suspended: true }]) {
    const configure = createControllerBindings();
    configure({ ...context, actions, synchronized: true });
    assert.deepEqual(configure({ ...context, ...changed, actions: [{ ...actions[0], type: 'live.start' }], synchronized: true }).actions, []);
    assert.deepEqual(configure({ ...context }).actions, []);
  }
});

test('confirmed snapshots are isolated from subsequent edits to their input and output', () => {
  const configure = createControllerBindings();
  const mutable = structuredClone(actions);
  const result = configure({ ...context, actions: mutable, synchronized: true });
  mutable[0].shortcut = 'Control+Alt+Shift+F3';
  result.actions[0].type = 'live.start';
  assert.deepEqual(configure({ ...context }).actions, actions);
});

test('transport errors and temporary HTTP failures preserve mappings; rejection and invalid payloads suspend them', () => {
  for (const error of [{ transportUnavailable: true }, { status: 408 }, { status: 429 }, { status: 500 }, { status: 503 }, { status: 599 }]) assert.equal(isTemporaryControllerFailure(error), true);
  for (const error of [new SyntaxError('Invalid JSON'), new Error('IndexedDB unavailable'), { status: 401 }, { status: 403 }, { status: 409 }, { status: 400, transportUnavailable: true }, { status: 401, transportUnavailable: true }, { status: 200 }]) assert.equal(isTemporaryControllerFailure(error), false);
});

test('native configuration errors are readable and redact the current credential', () => {
  const message = controllerConfigurationError(new Error("Error invoking remote method 'controller:configure': Error: Adresse refusée " + context.credential), context.credential);
  assert.match(message, /Configuration des macros impossible : Adresse refusée/);
  assert.match(message, /\[masqué\]/);
  assert.equal(message.includes(context.credential), false);
});

test('an autonomous agent keeps verified mappings through a failed read, but never across a replaced workspace',()=>{
 const configure=createControllerBindings(),local={server:'',credential:'',localWorkspace:'local:one',actions};
 const initial=configure({...local,synchronized:true});
 assert.deepEqual(configure({...local,actions:[]}),initial);
 assert.deepEqual(configure({...local,localWorkspace:'local:replacement'}).actions,[]);
 assert.deepEqual(configure(local).actions,[]);
});
