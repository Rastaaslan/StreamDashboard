(() => {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (!descriptor?.get || !descriptor?.set) return;

  function shouldPreserveView(element) {
    if (!(element instanceof Element) || element.id !== 'view') return false;
    const active = document.activeElement;
    if (active && element.contains(active) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return true;
    return Boolean(element.querySelector('form[data-dirty="true"]'));
  }

  Object.defineProperty(Element.prototype, 'innerHTML', {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get: descriptor.get,
    set(value) {
      if (shouldPreserveView(this)) return;
      descriptor.set.call(this, value);
    },
  });

  document.addEventListener('input', event => {
    const form = event.target instanceof Element ? event.target.closest('#view form') : null;
    if (form) form.dataset.dirty = 'true';
  }, true);

  document.addEventListener('change', event => {
    const form = event.target instanceof Element ? event.target.closest('#view form') : null;
    if (form) form.dataset.dirty = 'true';
  }, true);

  document.addEventListener('submit', event => {
    const form = event.target instanceof HTMLFormElement && event.target.closest('#view') ? event.target : null;
    if (form) delete form.dataset.dirty;
  }, true);

  document.addEventListener('reset', event => {
    const form = event.target instanceof HTMLFormElement && event.target.closest('#view') ? event.target : null;
    if (form) delete form.dataset.dirty;
  }, true);

  document.addEventListener('close', event => {
    if (!(event.target instanceof HTMLDialogElement)) return;
    event.target.querySelectorAll('form[data-dirty="true"]').forEach(form => delete form.dataset.dirty);
  }, true);
})();
