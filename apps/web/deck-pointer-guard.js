(() => {
  document.addEventListener('pointerdown', async event => {
    const target = event.target instanceof Element ? event.target.closest('.deck:not(.fun) .pad') : null;
    if (!(target instanceof HTMLButtonElement)) return;
    const scene = target.querySelector('b')?.textContent?.trim();
    if (!scene) return;
    try {
      await fetch('/api/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'obs.scene', scene }),
      });
    } catch {
      // app.js will continue to surface command errors through the normal UI path.
    }
  }, true);
})();
