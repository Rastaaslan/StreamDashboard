/**
 * Choose only an already configured HTTPS executor from the installation
 * topology. Never discover or send measurements to an arbitrary LAN host.
 */
export function djiRelayTarget({installation, activeServer, localEndpoint} = {}) {
  const devices = Array.isArray(installation?.devices) ? installation.devices : [];
  const secure = device => Boolean(device && device.enabled === true
    && typeof device.endpoint === 'string'
    && /^https:\/\/[^/?#]+$/.test(device.endpoint)
    && device.id !== installation?.localDeviceId
    && device.endpoint !== localEndpoint);
  const preferred = devices.find(device => device.id === installation?.routes?.obs);
  if (secure(preferred)) return preferred.endpoint;
  const selected = devices.find(device => device.endpoint === activeServer && secure(device));
  return selected?.endpoint || '';
}
