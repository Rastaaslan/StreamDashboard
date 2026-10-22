import {execFileSync} from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

execFileSync(process.execPath,['scripts/build-public-assets.mjs'],{stdio:'inherit'});
const source = path.resolve('.build/public/mobile');
const destination = path.resolve('android/app/src/main/assets/public');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
console.log('Android assets synchronized from apps/mobile');
