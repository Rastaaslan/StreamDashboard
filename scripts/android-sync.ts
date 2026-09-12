import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const source = path.resolve('apps/mobile');
const destination = path.resolve('android/app/src/main/assets/public');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
console.log('Android assets synchronized from apps/mobile');
