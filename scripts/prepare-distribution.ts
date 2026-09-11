import { readFile, writeFile } from 'node:fs/promises';
const file = new URL('../resources/distribution.json', import.meta.url);
const current = JSON.parse(await readFile(file, 'utf8')) as { twitchClientId?: string; googleClientId?: string };
const twitchClientId = process.env.TWITCH_CLIENT_ID?.trim() || current.twitchClientId?.trim();
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || current.googleClientId?.trim() || '';
if (!twitchClientId) throw new Error('TWITCH_CLIENT_ID est requis pour produire une distribution Twitch fonctionnelle.');
await writeFile(file, JSON.stringify({ twitchClientId, googleClientId }, null, 2) + '\n');
console.log(`Configuration publique de distribution injectée (Google ${googleClientId ? 'configuré' : 'non configuré'}).`);
