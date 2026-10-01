const TWITCH_AUTH_HOSTS = new Set(['twitch.tv', 'www.twitch.tv']);
const GOOGLE_AUTH_HOSTS = new Set(['accounts.google.com']);
const STREAMLABS_AUTH_HOSTS = new Set(['streamlabs.com', 'www.streamlabs.com']);

export function isAllowedTwitchUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && TWITCH_AUTH_HOSTS.has(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export function isAllowedGoogleOAuthUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && GOOGLE_AUTH_HOSTS.has(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export function isAllowedStreamlabsOAuthUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && STREAMLABS_AUTH_HOSTS.has(url.hostname)
      && url.pathname === '/api/v2.0/authorize'
      && !url.username
      && !url.password;
  } catch { return false; }
}

export function isAllowedExternalAuthUrl(value: string) {
  return isAllowedTwitchUrl(value) || isAllowedGoogleOAuthUrl(value) || isAllowedStreamlabsOAuthUrl(value);
}

export function isSameOrigin(candidate: string, expected: string) {
  try { return new URL(candidate).origin === new URL(expected).origin; }
  catch { return false; }
}
