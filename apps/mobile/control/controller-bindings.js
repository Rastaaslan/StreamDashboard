/** Keep only host-confirmed mappings. UI/network availability must not own global keys. */
export function createControllerBindings() {
  let confirmed;
  return ({ server, credential, actions = [], synchronized = false, suspended = false }) => {
    if (suspended || !server || (confirmed && (confirmed.server !== server || confirmed.credential !== credential))) confirmed = undefined;
    if (!suspended && server && synchronized) confirmed = { server, credential, actions: structuredClone(actions) };
    return { server, credential, actions: structuredClone(confirmed?.actions || []) };
  };
}

/** Authentication, invalid payloads and local-storage errors must still suspend commands. */
export function isTemporaryControllerFailure(error) {
  const status = error?.status;
  if (Number.isInteger(status) && status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
  return error?.transportUnavailable === true || status === 408 || status === 429 || (Number.isInteger(status) && status >= 500 && status <= 599);
}

export function controllerConfigurationError(error, credential = '') {
  let message = typeof error?.message === 'string' ? error.message : 'Réessayez la connexion à la régie.';
  message = message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  if (credential) message = message.split(credential).join('[masqué]');
  return 'Configuration des macros impossible : ' + message.slice(0, 350);
}
