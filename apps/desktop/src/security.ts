const TWITCH_AUTH_HOSTS = new Set(['twitch.tv', 'www.twitch.tv']);
const GOOGLE_AUTH_HOSTS = new Set(['accounts.google.com']);

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

export function isAllowedExternalAuthUrl(value: string) {
  return isAllowedTwitchUrl(value) || isAllowedGoogleOAuthUrl(value);
}

export function isSameOrigin(candidate: string, expected: string) {
  try { return new URL(candidate).origin === new URL(expected).origin; }
  catch { return false; }
}
