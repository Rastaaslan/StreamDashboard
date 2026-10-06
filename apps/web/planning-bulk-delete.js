import { openDialog, closeDialog, dialogCompletion } from './dialog-drafts.js';
/** Shared desktop period deletion dialog. The server owns selection and confirmation. */
export function openBulkDelete({ onComplete = () => {}, request = api } = {}) {
  const existing = document.querySelector('dialog[data-bulk-delete][open]');
  if (existing) return existing;
  const dialog = document.createElement('dialog');
  dialog.dataset.bulkDelete = '';
  dialog.setAttribute('aria-label', 'Supprimer une période');
  dialog.innerHTML = `<form>
    <h2>Supprimer une période</h2>
    <p>Seuls les événements locaux entièrement compris dans la période seront supprimés. Les séries et occurrences récurrentes sont exclues.</p>
    <label>Début <input name="start" type="datetime-local" required></label>
    <label>Fin <input name="end" type="datetime-local" required></label>
    <p>Les copies distantes sont conservées par défaut.</p>
    <div class="checks"><label><input name="twitch" type="checkbox"> Supprimer aussi sur Twitch</label>
    <label><input name="google" type="checkbox"> Supprimer aussi sur Google Calendar</label></div>
    <button class="secondary ghost" type="submit">Afficher l’aperçu</button>
    <div data-preview aria-live="polite"></div>
    <div class="checks"><label><input name="confirm" type="checkbox" disabled> Je confirme la suppression des événements et destinations affichés.</label></div>
    <div class="dialog-actions"><button class="secondary ghost" type="button" data-close>Fermer</button><button class="critical danger" type="button" data-delete disabled>Supprimer les événements affichés</button></div>
    <p data-result role="status"></p>
  </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form'), fields = form.elements;
  const previewHost = dialog.querySelector('[data-preview]'), result = dialog.querySelector('[data-result]');
  const remove = dialog.querySelector('[data-delete]');
  let preview = null, busy = false, generation = 0;
  const invalidate = () => { generation++; preview = null; fields.confirm.checked = false; fields.confirm.disabled = true; remove.disabled = true; previewHost.replaceChildren(); };
  for (const name of ['start', 'end', 'twitch', 'google']) fields[name].addEventListener('input', invalidate);
  fields.confirm.onchange = () => { remove.disabled = busy || !preview?.count || !fields.confirm.checked; };
  const setBusy = value => { busy = value; for (const name of ['start', 'end', 'twitch', 'google']) fields[name].disabled = value; form.querySelector('[type=submit]').disabled = value; fields.confirm.disabled = value || !preview?.count; remove.disabled = value || !preview?.count || !fields.confirm.checked; };
  dialog.querySelector('[data-close]').onclick = () => { if (!busy) closeDialog(dialog); };
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove());
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    invalidate(); result.textContent = ''; const current = generation, complete = dialogCompletion(dialog);
    try {
      const start = new Date(fields.start.value).toISOString(), end = new Date(fields.end.value).toISOString();
      if (start >= end) throw new Error('Le début doit précéder la fin.');
      setBusy(true);
      const response = await request('/api/v1/planning/bulk-delete/preview', { start, end, destinations: { twitch: fields.twitch.checked, google: fields.google.checked } });
      if (current !== generation || !complete()) return;
      preview = response;
      const heading = document.createElement('p');
      heading.textContent = `${preview.count} événement(s) à supprimer — destinations : local${preview.destinations.twitch ? ', Twitch' : ''}${preview.destinations.google ? ', Google Calendar' : ''}.`;
      previewHost.append(heading);
      const list = document.createElement('ul');
      for (const item of preview.items) { const row = document.createElement('li'); row.textContent = `${item.title} — ${new Date(item.startAtUtc).toLocaleString()} → ${new Date(item.endAtUtc).toLocaleString()}`; list.append(row); }
      previewHost.append(list);
      for (const item of preview.excluded) { const row = document.createElement('p'); row.textContent = `Exclu : ${item.title} — ${item.reason}`; previewHost.append(row); }
    } catch (error) { if (complete()) result.textContent = error.message; }
    finally { if (complete()) setBusy(false); }
  };
  remove.onclick = async () => {
    if (busy || !preview?.count || !fields.confirm.checked) return;
    setBusy(true);
    const complete = dialogCompletion(dialog);
    try {
      const response = await request('/api/v1/planning/bulk-delete/confirm', { token: preview.token, confirm: true });
      if (!complete()) return;
      invalidate();
      result.textContent = `${response.deleted.length} événement(s) supprimé(s). ${response.failed.length} échec(s).`;
      for (const failure of response.failed) { const row = document.createElement('p'); row.textContent = `${failure.title} : ${failure.error} Refaire l’aperçu pour réessayer.`; result.append(row); }
      await onComplete();
    } catch (error) { if (complete()) { invalidate(); result.textContent = error.message; } }
    finally { if (dialog.open && dialog.isConnected) setBusy(false); }
  };
  openDialog(dialog);
  return dialog;
}
async function api(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.message || (typeof data.error === 'string' ? data.error : '') || 'Suppression refusée. Refaire l’aperçu.');
  return data;
}
