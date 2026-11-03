/** The advanced control surface follows the pinned regie, even when a laptop
 * has a separate local chat/account runtime. It never selects a fallback. */
export function liveControlTarget({server,localEndpoint,clientRole,online,sourceKey}){
  if(typeof server!=='string'||!server||online!==true||sourceKey!==server||
    clientRole===true&&server===localEndpoint)throw Error('REGIE_CONTROL_UNAVAILABLE');
  return server;
}
