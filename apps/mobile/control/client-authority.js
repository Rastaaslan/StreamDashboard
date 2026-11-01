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
  if(!installation||installation.runtimeProfile!=='device-runtime')return '';
  const candidates=(installation.devices||[]).filter(d=>d&&d.enabled===true&&d.id!==installation.localDeviceId&&
    Array.isArray(d.roles)&&d.roles.includes('obs-executor')&&safeRemoteEndpoint(d.endpoint));
  const designated=candidates.find(d=>d.id===installation.routes?.obs);
  const host=designated||(candidates.length===1?candidates[0]:undefined);
  return host?safeRemoteEndpoint(host.endpoint):'';
}
export function clientMustDelegateCommand(clientRole,path,body) {
  return clientRole&&path==='/api/v1/commands'&&typeof body?.type==='string'&&
    (body.type.startsWith('timer.')||body.type==='session.prepare');
}
