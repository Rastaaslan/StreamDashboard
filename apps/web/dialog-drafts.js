/** The live DOM is the dialog draft. Revisions also reject stale async writes,
 * including edit-then-undo and IME composition with an unchanged value. */
const revisions = new WeakMap();
const sessions = new WeakMap();
export function draftRevision(element) { return revisions.get(element) || 0; }
function touch(element) { revisions.set(element, draftRevision(element) + 1); }
// Explicit opening invalidates completions even before the queued native close event.
export function beginDialogDraft(dialog) { touch(dialog); sessions.set(dialog, { creating: false }); }
export function changeDialogDraft(dialog) { touch(dialog); }
// Creation identity belongs to the open session, independently of subsequent typing.
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
