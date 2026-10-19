import { createHash } from 'node:crypto';
import { decodeHTML } from 'entities';

export interface WizeBotCommand { id: string; aliases: string[]; publishedText: string; kind: string; cost: string; revision: string }
export function parseWizeBotCatalog(value: unknown): WizeBotCommand[] {
  const rows = (value as { data?: unknown })?.data;
  if (!Array.isArray(rows) || rows.length > 5000) throw new Error('Liste WizeBot invalide : les boutons existants sont conservés.');
  const ids = new Set<string>();
  return rows.map(row => {
    if (!Array.isArray(row) || row.length < 7 || !row.slice(0,6).every(v => typeof v === 'string') || !/^\d{1,30}$/.test(row[1]) || ids.has(row[1])) throw new Error('Format de liste WizeBot non reconnu.');
    ids.add(row[1]);
    const plain = (s: string) => decodeHTML(s.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,''));
    const aliases = [...new Set(plain(row[0]).split(/[\s,|]+/).filter(v => /^![\p{L}\p{N}_-]{1,80}$/u.test(v)))];
    const publishedText = plain(row[2]);
    if (publishedText.length > 20000) throw new Error('Réponse WizeBot trop longue.');
    return { id: row[1], aliases, publishedText, kind: row[5], cost: row[3], revision: createHash('sha256').update(JSON.stringify(row.slice(0,7))).digest('hex') };
  });
}

/** Read-only public website adapter, observed 2026-10-19. No private panel endpoints or API keys. */
export class WizeBotCatalogClient {
  constructor(private request: typeof fetch = fetch) {}
  async list(channel: string): Promise<WizeBotCommand[]> {
    if (!/^[a-z0-9_]{1,25}$/.test(channel)) throw new Error('Connectez votre chaîne Twitch sur FIXE.');
    const base = `https://${channel}.streaming.lv/`;
    const cookies = new Map<string,string>();
    const signal = AbortSignal.timeout(15_000);
    const read = async (url: string, body?: URLSearchParams) => {
      const response = await this.request(url, { method: body ? 'POST' : 'GET', redirect: 'error', signal,
        headers: { accept: '*/*', 'cache-control': 'no-cache', ...(cookies.size ? { cookie: [...cookies.values()].join('; ') } : {}) }, ...(body ? {body} : {}) });
      if (!response.ok) throw new Error(`Liste publique WizeBot indisponible (HTTP ${response.status}).`);
      // Ephemeral anonymous public-site session, held in memory for this read only.
      for (const cookie of response.headers.getSetCookie()) { const pair=cookie.split(';')[0]; cookies.set(pair.split('=')[0],pair); }
      const reader=response.body?.getReader(); if(!reader) throw new Error('Réponse WizeBot vide.');
      const chunks: Uint8Array[]=[];let bytes=0;
      for (;;) { const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>2_000_000){await reader.cancel();throw new Error('Liste WizeBot trop volumineuse.');}chunks.push(next.value); }
      return Buffer.concat(chunks).toString('utf8');
    };
    await read(base+'?commands');
    const page = await read(base+'ajax.php',new URLSearchParams({p:'commands','request[commands]':''}));
    const resource = page.match(/ajax:\s*['"](ajax\/list\/commands_list\.php\?t=[a-f0-9]{32,128})['"]/i)?.[1];
    if (!resource) throw new Error('Liste publique WizeBot absente ou format modifié. Activez « Liste des commandes (Site externe) » dans WizeBot.');
    let json: unknown;try { json=JSON.parse(await read(base+resource)); } catch { throw new Error('Liste publique WizeBot illisible. Les données précédentes sont conservées.'); }
    return parseWizeBotCatalog(json);
  }
}
