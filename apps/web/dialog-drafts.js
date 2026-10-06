/** The live DOM is the dialog draft. Revisions also reject stale async writes,
 * including edit-then-undo and IME composition with an unchanged value. */
const revisions = new WeakMap();
const sessions = new WeakMap();
// Native close events are queued: deliver teardown synchronously for managed
// closes and suppress their later native event, even after a same-task reopen.
const synchronousCloses = new WeakSet();
let openingGeneration = 0;
export function reserveDialogOpen() {
  const generation = ++openingGeneration;
  return () => generation === openingGeneration;
}
export function closeDialog(dialog) {
  if (!dialog?.open) return;
  dialog.close();
  synchronousCloses.add(dialog);
  try { dialog.dispatchEvent(new Event('close')); }
  finally { synchronousCloses.delete(dialog); }
}
export function openDialog(dialog) {
  if (dialog.open) return;
  ++openingGeneration;
  for (const other of document.querySelectorAll('dialog[open]')) {
    if (other !== dialog) closeDialog(other);
  }
  beginDialogDraft(dialog);
  try { dialog.showModal(); }
  catch (error) { sessions.delete(dialog); touch(dialog); throw error; }
}
// Read-only, opt-in diagnostics for browser tests / the development console.
// No field values, credentials or user data are collected.
export function dialogDiagnostics() {
  const dialogs = [...document.querySelectorAll('dialog')];
  const open = dialogs.filter(dialog => dialog.open);
  return {
    openCount: open.length,
    modalCount: dialogs.filter(dialog => dialog.matches(':modal')).length,
    orphanModal: dialogs.some(dialog => dialog.matches(':modal') && !dialog.open),
    lostFocus: open.length > 0 && !open.some(dialog => dialog.contains(document.activeElement)),
    staleSession: dialogs.some(dialog => sessions.has(dialog) && !dialog.open),
  };
}
document.addEventListener('close', event => {
  const dialog = event.target;
  if (synchronousCloses.has(dialog)) return;
  // Chromium may coalesce a close event away on immediate reopen. Do not
  // count expected events: such a counter would swallow the next real Escape.
  if (dialog.open || !sessions.has(dialog)) event.stopImmediatePropagation();
}, true);
export function draftRevision(element) { return revisions.get(element) || 0; }
function touch(element) { revisions.set(element, draftRevision(element) + 1); }
// Explicit opening invalidates completions even before the queued native close event.
export function beginDialogDraft(dialog) { touch(dialog); sessions.set(dialog, { creating: false }); }
export function changeDialogDraft(dialog) { touch(dialog); }
// Mutation ownership belongs to the open session, independently of typing.
// The same lock covers edits/deletes; creation callers also adopt the returned ID.
export function dialogCreation(dialog) {
  const session = sessions.get(dialog);
  if (!session || session.creating) return null;
  session.creating = true;
  return {
    isCurrent: () => dialog.isConnected && dialog.open && sessions.get(dialog) === session,
    finish: () => { session.creating = false; },
  };
}
export function dialogCompletion(dialog) {
  const revision = draftRevision(dialog);
  const values = () => JSON.stringify([...dialog.querySelectorAll('input,textarea,select')].map(field => [field.value, field.checked]));
  const submitted = values();
  return () => dialog.isConnected && dialog.open && draftRevision(dialog) === revision && values() === submitted;
}
export function ownsKeyboard(event) {
  const target = event.target;
  return event.isComposing || target?.isContentEditable || Boolean(target?.closest?.('input,textarea,select,dialog[open]')) || Boolean(document.querySelector('dialog[open]'));
}
for (const type of ['input', 'change', 'compositionstart', 'compositionend', 'reset', 'close']) {
  document.addEventListener(type, event => {
    const dialog = event.target.closest?.('dialog');
    if (!dialog) return;
    touch(dialog);
    touch(event.target);
    if (['input', 'change', 'compositionstart'].includes(type)) dialog.dataset.dirty = 'true';
    if (type === 'reset' || type === 'close') dialog.dataset.dirty = 'false';
    if (type === 'close') sessions.delete(dialog);
  }, true);
}
// Escape belongs to the IME candidate window until composition completes.
const composing = new WeakSet();
document.addEventListener('compositionstart', event => composing.add(event.target), true);
document.addEventListener('compositionend', event => composing.delete(event.target), true);
document.addEventListener('keydown', event => {
  if ((event.isComposing || composing.has(event.target)) && ['Escape', 'Enter'].includes(event.key)) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
}, true);
