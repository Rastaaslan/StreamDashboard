import { resolveCapability } from '../shared/installation.js';
import { actionDefinition, actionCapability } from '../shared/action-definition.js';

/** Connections are isolated by physical device and origin. A failed command is
 * never queued, retried, or redirected to the currently selected workspace. */
export function createActionRouter({ installation, workspace, localEndpoint, credential, request, now = Date.now }) {
  const states = new Map(), flights = new Map();
  const binding = action => installation().actionRoutes?.find(r => r.workspace === workspace() && r.actionId === action.id);
  const device = id => installation().devices.find(d => d.id === id);
  const endpoint = target => target.id === installation().localDeviceId ? localEndpoint : target.endpoint;
  function status(action) {
    const route = binding(action);
    if (!route) return null;
    const target = device(route.deviceId), known = states.get(route.deviceId);
    const observed = known && known.endpoint === endpoint(target || {}) && now() - known.at < 15_000 ? {[route.deviceId]: known.observation} : {};
    let availability=resolveCapability(installation(), actionCapability(route.definition.type), observed, route.deviceId);
    if(route.deviceId!==installation().localDeviceId&&!observed[route.deviceId]&&['agent-stopped','role-stopped'].includes(availability.reason))availability={...availability,status:'unknown',reason:'not-observed',message:'Rôles actuels à vérifier sur cet appareil.'};
    return { ...availability, name:target?.name, route };
  }
  async function observe(id, force = false) {
    const topology = installation(), target = device(id);
    if (!target?.enabled) throw new Error('Appareil retiré ou désactivé.');
    const origin = endpoint(target);
    if (!origin) throw new Error('Cet appareil n’expose pas de service de commandes distant.');
    const previous = states.get(id);
    if (!force && previous?.endpoint === origin && now() - previous.at < 5_000 && previous.data) return previous;
    const key = id + ':' + topology.revision + ':' + origin;
    if (flights.has(key)) return flights.get(key);
    const operation = (async () => {
      try {
        const token = origin === localEndpoint ? '' : await credential(origin);
        if (!token && origin !== localEndpoint) throw new Error('Associez cet appareil avant de l’utiliser.');
        const descriptor = await request('/api/v2/device',undefined,'GET',origin,token);
        // 2.1 routing requires a verified physical identity, never an IP alone.
        if (descriptor.device?.id !== id) throw new Error('L’identité de l’appareil a changé. Renouvelez son association.');
        const data = await request('/api/v2/state',undefined,'GET',origin,token);
        if (!Array.isArray(data.configuration?.actions)) throw new Error('État de l’appareil illisible.');
        if (installation().revision !== topology.revision || endpoint(device(id) || {}) !== origin) throw new Error('Installation modifiée pendant la vérification.');
        const value = { endpoint:origin, token, at:now(), data, observation:{connected:true, roles:descriptor.device.roles, permissions:descriptor.observed?.permissions, obsConnected:data.host?.state?.obs?.connected === true} };
        states.set(id,value);return value;
      } catch (error) {
        states.set(id,{endpoint:origin,at:now(),observation:{connected:false}});throw error;
      } finally { flights.delete(key); }
    })();
    flights.set(key,operation);return operation;
  }
  async function prepare(action) {
    const initial = status(action);
    if (!initial) return null;
    if (initial.status === 'unavailable' && ['disabled','unsupported'].includes(initial.reason)) throw new Error(initial.message);
    const revision = installation().revision, route = structuredClone(initial.route);
    const target = await observe(route.deviceId, true);
    if (installation().revision !== revision || JSON.stringify(binding(action)) !== JSON.stringify(route)) throw new Error('Destination modifiée. Vérifiez le bouton avant de réessayer.');
    const available = status(action);
    if (available.status !== 'available') throw new Error(available.message);
    const definition = target.data.configuration.actions.find(a => a.id === route.definition.id);
    if (actionDefinition(definition) !== actionDefinition(route.definition)) throw new Error('Le bouton a changé sur l’appareil cible. Vérifiez son association avant de le déclencher.');
    return {...target, definition, deviceId:route.deviceId, name:device(route.deviceId).name};
  }
  async function execute(action, command) {
    const target = await prepare(action);
    if (!target) throw new Error('Aucune destination associée à ce bouton.');
    // One dispatch only. This result identifies the executor even if the UI has
    // selected a different workspace while the request was in flight.
    const result = await request('/api/v2/actions',{...command,action:target.definition.id,expectedAction:target.definition},'POST',target.endpoint,target.token);
    return {...result,deviceId:target.deviceId,deviceName:target.name};
  }
  return { binding, status, observe, prepare, execute };
}
