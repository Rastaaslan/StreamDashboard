export function isAllowedTwitchUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'twitch.tv' || url.hostname === 'www.twitch.tv' || url.hostname.endsWith('.twitch.tv')); } catch { return false; }
}
export function isSameOrigin(candidate: string, expected: string) { try { return new URL(candidate).origin === new URL(expected).origin; } catch { return false; } }
