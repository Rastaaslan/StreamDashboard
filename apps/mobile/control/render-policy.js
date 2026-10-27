/** Rendering is data-driven; polling must never own a form or a pressed pad. */
const markup = new WeakMap();
/** @param {Element|null} element @param {string} html */
export function replaceMarkup(element, html) {
  if (!element) return false;
  const previous=markup.get(element);
  if(previous?.html===html&&previous.first===element.firstChild&&previous.last===element.lastChild&&element.childNodes.length)return false;
  element.innerHTML = html;
  markup.set(element, {html,first:element.firstChild,last:element.lastChild});
  return true;
}
/** @param {Element|null} root @param {Element|null} [active] */
export function editingForm(root, active = globalThis.document?.activeElement) {
  return Boolean(root?.querySelector('form[data-editing="true"]') ||
    (active && root?.contains(active) && active?.matches('input, textarea, select, [contenteditable]')));
}

/** Each draft captures its owner. Switching workspaces cannot redirect a write. */
/** @param {{delay?:number,onError?:(error:unknown)=>void}} [options] */
export function createDraftWriter({delay = 250, onError = () => {}} = {}) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
  /** @type {(()=>void|Promise<void>)|undefined} */ let pending;
  let flight = Promise.resolve();
  const flush = () => {
    clearTimeout(timer);
    const next = pending;
    pending = undefined;
    if (next) flight = flight.catch(() => {}).then(next).catch(onError);
    return flight;
  };
  /** @param {()=>void|Promise<void>} write */
  const schedule=write=>{pending=write;clearTimeout(timer);timer=setTimeout(flush,delay);};
  return {schedule, flush};
}
