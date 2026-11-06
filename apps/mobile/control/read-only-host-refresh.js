/** Inspect FIXE without sending the local outbox or touching OAuth/session commands.
 * The only remote operation is a GET. accept() may update the local replica cache,
 * but must never submit staged edits to the remote agent.
 */
export async function observeHostReadOnly({workspace,request,accept,isCurrent,now=()=>Date.now()}) {
  if(typeof workspace!=='string'||!workspace||!isCurrent())throw new Error('Régie sélectionnée non vérifiable.');
  const response=await request('/api/v2/autonomy','GET');
  // Do not apply a late response from a previously selected host/workspace.
  if(!isCurrent())return false;
  if(response?.workspace!==workspace||!response.bundle?.data?.host?.state)
    throw new Error('Identité ou état de la régie inattendu : les données locales sont conservées.');
  const at=response.bundle.data.host.state.at;
  const observedAt=typeof at==='string'?Date.parse(at):NaN;
  const age=now()-observedAt;
  if(!Number.isFinite(observedAt)||age>90_000||age< -15_000)
    throw new Error('La régie répond mais son observation est absente ou périmée.');
  await accept(response);
  return isCurrent();
}
