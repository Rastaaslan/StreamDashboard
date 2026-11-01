/** Isolated review panel. readLatest is read-only; draft retrieval does not save it. */
export function mountPlanningProposal(root, { proposal, readLatest, now = Date.now }) {
  const doc = root.ownerDocument;
  const panel = doc.createElement('section');
  panel.setAttribute('aria-label', 'Proposition de planning');
  const title = doc.createElement('h3');
  const dates = doc.createElement('p');
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const confirm = doc.createElement('button');
  const cancel = doc.createElement('button');
  confirm.type = cancel.type = 'button';
  confirm.textContent = 'Confirmer le brouillon';
  cancel.textContent = 'Annuler';
  let destroyed = false, cancelled = false, busy = false, draft;
  const format = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'long' });
  title.textContent = `Dupliquer : ${proposal.preview.title}`;
  dates.textContent = `${format.format(new Date(proposal.preview.from))} → ${format.format(new Date(proposal.preview.to))} (Europe/Paris)`;
  const conflicts = proposal.preview.conflicts;
  status.textContent = conflicts.length
    ? `Chevauchement : ${conflicts.map(c => c.title).join(', ')}. Choisir un autre créneau.`
    : 'Proposition en lecture seule. La confirmation prépare un brouillon ; aucun calendrier ni Twitch ne sera modifié.';
  confirm.disabled = conflicts.length > 0;
  async function confirmDraft() {
    if (destroyed || cancelled || busy || draft || confirm.disabled) return;
    busy = true;
    confirm.disabled = true;
    status.textContent = 'Vérification des observations…';
    try {
      const latest = await readLatest();
      if (destroyed || cancelled) return;
      draft = proposal.confirm(latest, now());
      status.textContent = 'Brouillon préparé, non enregistré et non publié. Reprendre dans Planning pour enregistrer.';
      cancel.disabled = true;
    } catch (error) {
      if (!destroyed && !cancelled) {
        status.textContent = `Confirmation impossible : ${error instanceof Error ? error.message : String(error)}`;
        confirm.disabled = false;
      }
    } finally { busy = false; }
  }
  function cancelDraft() {
    if (destroyed || draft) return;
    cancelled = true;
    proposal.cancel();
    confirm.disabled = cancel.disabled = true;
    status.textContent = 'Proposition annulée. Aucun événement créé.';
  }
  confirm.addEventListener('click', confirmDraft);
  cancel.addEventListener('click', cancelDraft);
  panel.append(title, dates, status, confirm, cancel);
  root.append(panel);
  return {
    confirm: confirmDraft,
    cancel: cancelDraft,
    getDraft: () => draft ? structuredClone(draft) : undefined,
    destroy() {
      destroyed = true;
      if (!draft) proposal.cancel();
      confirm.removeEventListener('click', confirmDraft);
      cancel.removeEventListener('click', cancelDraft);
      panel.remove();
    },
  };
}
