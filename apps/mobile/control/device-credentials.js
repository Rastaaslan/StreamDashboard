import { credentialStorage } from '../storage.js';
import { installationEndpoint } from '../shared/installation.js';

// Credentials are keyed by their verified executor origin. Unknown targets
// never receive the last-used device's credential.
export function createDeviceCredentials({desktop=globalThis.streamDashboardDesktop,native=globalThis.StreamDashboardNative,storage=localStorage}={}) {
  const legacyGet=()=>desktop?.getControllerCredential?.()??credentialStorage.get();
  const legacySet=value=>desktop?.setControllerCredential?.(value)??credentialStorage.set(value);
  async function get(target) {
    if(!target)return '';
    const server=installationEndpoint(target);
    if(desktop?.getDeviceCredential)return desktop.getDeviceCredential(server);
    if(native?.getDeviceCredential)return native.getDeviceCredential(server)||'';
    if(desktop||native)return server===storage.getItem('sd2.server')?legacyGet():'';
    return storage.getItem('sd2.credential.'+server)||'';
  }
  async function set(value,target) {
    const server=installationEndpoint(target);
    if(desktop?.setDeviceCredential)await desktop.setDeviceCredential(server,value);
    else if(native?.setDeviceCredential){if(native.setDeviceCredential(server,value)!==true)throw new Error('Association non enregistrée dans le stockage sécurisé.');}
    else if(desktop||native){if(server!==storage.getItem('sd2.server'))throw new Error('Mettez à jour l’application pour associer plusieurs appareils.');}
    else storage.setItem('sd2.credential.'+server,value);
    // Keep RC11.7 rollback able to read the most recently selected association.
    await legacySet(value);
  }
  async function initialize(){
    const server=storage.getItem('sd2.server');if(!server)return '';
    const saved=await get(server);if(saved)return saved;
    const old=await legacyGet();if(old)await set(old,server);return old;
  }
  return {get,set,initialize};
}
