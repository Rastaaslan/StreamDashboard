export const NATIVE_ORIGIN = 'http://localhost';
export const DEFAULT_PORT = 47832;

export function isAndroidRuntime() {
  return Boolean(globalThis.StreamDashboardNative?.isAndroid?.());
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

export function normalizeServer(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('Adresse du PC requise.');
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `http://${input}`;
  let url;
  try { url = new URL(candidate); } catch { throw new Error('Adresse du PC invalide.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Adresse non autorisée. Utilise uniquement une adresse LAN sans identifiants.');
  }
  const host = url.hostname.toLowerCase();
  const localHostname = host === 'localhost' || host.endsWith('.local') || (!host.includes('.') && /^[a-z0-9-]+$/i.test(host));
  if (!isPrivateIpv4(host) && !localHostname) throw new Error('Seule une adresse privée du réseau local est autorisée.');
  if (url.protocol === 'https:' && host !== 'localhost') throw new Error('Le serveur StreamDashboard LAN utilise HTTP.');
  const port = url.port || String(DEFAULT_PORT);
  return `${url.protocol}//${host}:${port}`;
}

export function parsePairing(value) {
  const input = String(value || '').trim();
  let url;
  try { url = new URL(input); } catch { throw new Error('Lien d’appairage invalide.'); }
  if (url.protocol !== 'streamdashboard:' || url.hostname !== 'pair') throw new Error('Protocole d’appairage invalide.');
  if (url.searchParams.get('v') !== '1') throw new Error('Version d’appairage inconnue.');
  const server = normalizeServer(url.searchParams.get('server'));
  const id = url.searchParams.get('id')?.trim();
  const code = url.searchParams.get('code')?.trim();
  if (!id) throw new Error('ID d’appairage manquant.');
  if (!code) throw new Error('Code d’appairage manquant.');
  return { server, id, code };
}

export function apiUrl(baseUrl, path) {
  return `${String(baseUrl).replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}

export function websocketUrl(baseUrl, ticket) {
  const url = new URL(apiUrl(baseUrl, '/ws/v1'));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', ticket);
  return url.href;
}

export function nextRetry(current) {
  return Math.min(10_000, Math.max(500, Number(current) || 500) * 2);
}
