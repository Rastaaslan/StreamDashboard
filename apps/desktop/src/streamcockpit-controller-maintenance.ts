import type {ElectronSecretStore} from './secrets.js';
import type {PeerTransport} from './peer-transport.js';
import {validatePeerMaintenanceObserver} from './streamcockpit-peer-maintenance-observer.js';
/** Native main only. Reuses this client's existing pairing and pin in memory.
 * Never copies FIXE's OBS/Twitch account, changes a pairing, or logs secrets. */
export async function controllerMaintenanceObservation(store:ElectronSecretStore,peers:PeerTransport){
 const binding=await store.getControllerBindings();
 if(!binding?.server)throw Error('MAINTENANCE_PAIRED_FIXE_UNAVAILABLE');
 return validatePeerMaintenanceObserver({peer:{origin:binding.server,
  credential:await store.getControllerDevice(binding.server)||binding.credential,
  fingerprint:await peers.fingerprint(binding.server)}});
}
