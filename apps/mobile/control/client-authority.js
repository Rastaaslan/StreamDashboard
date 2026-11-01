/** A Windows client must never silently become its own stream regie. */
function safeRemoteEndpoint(value) {
  try {
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return '';
    if(['localhost','127.0.0.1','[::1]'].includes(url.hostname.toLowerCase()))return '';
    return url.origin;
  } catch {return ''}
}
export function clientAuthorityEndpoint(installation) {
  if(!installation||installation.runtimeProfile!=='device-runtime'||
    typeof installation.localDeviceId!=='string'||!installation.localDeviceId)return '';
  const devices=Array.isArray(installation.devices)?installation.devices:[];
  const candidates=devices.filter(d=>d&&typeof d.id==='string'&&d.id.length>0&&
    d.enabled===true&&d.id!==installation.localDeviceId&&
    Array.isArray(d.roles)&&d.roles.includes('obs-executor')&&safeRemoteEndpoint(d.endpoint));
  const route=installation.routes?.obs;
  // A configured authority is a pin, not a preference. If the FIXE entry
  // disappears or becomes invalid, never redirect timer/OBS commands to
  // another candidate merely because it is the only one remaining.
  if(route!==undefined&&route!==null){
    if(typeof route!=='string'||!route||route===installation.localDeviceId)return '';
    const matches=candidates.filter(d=>d.id===route);
    return matches.length===1&&devices.filter(d=>d?.id===route).length===1?
      safeRemoteEndpoint(matches[0].endpoint):'';
  }
  // Legacy profiles without an explicit route can use exactly one eligible
  // external OBS authority, with an unambiguous device identity.
  if(candidates.length!==1||devices.filter(d=>d?.id===candidates[0].id).length!==1)return '';
  return safeRemoteEndpoint(candidates[0].endpoint);
}
export function clientMustDelegateCommand(clientRole,path,body) {
  return clientRole&&path==='/api/v1/commands'&&typeof body?.type==='string'&&
    (body.type.startsWith('timer.')||body.type==='session.prepare');
}
