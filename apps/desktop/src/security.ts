export function isAllowedTwitchUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'twitch.tv' || url.hostname === 'www.twitch.tv' || url.hostname.endsWith('.twitch.tv')); } catch { return false; }
}
export function isAllowedGoogleOAuthUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'accounts.google.com'; } catch { return false; }
}
export function isAllowedExternalAuthUrl(value: string) { return isAllowedTwitchUrl(value) || isAllowedGoogleOAuthUrl(value); }
export function isSameOrigin(candidate: string, expected: string) { try { return new URL(candidate).origin === new URL(expected).origin; } catch { return false; } }
