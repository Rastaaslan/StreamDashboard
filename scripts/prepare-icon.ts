import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const encodedPath = fileURLToPath(new URL('../resources/streamdashboard.ico.b64', import.meta.url));
const iconPath = fileURLToPath(new URL('../resources/streamdashboard.ico', import.meta.url));
const encoded = readFileSync(encodedPath, 'utf8').trim();
writeFileSync(iconPath, Buffer.from(encoded, 'base64'));
console.log('Icône Windows reconstruite depuis streamdashboard.ico.b64.');
