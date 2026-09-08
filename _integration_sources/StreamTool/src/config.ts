import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Profile } from './types.js';
export async function loadProfile(name = process.env.PROFILE || 'dam'): Promise<Profile> {
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error('Invalid profile name');
  const file = path.resolve(process.cwd(), 'profiles', `${name}.json`);
  return JSON.parse(await readFile(file, 'utf8')) as Profile;
}
