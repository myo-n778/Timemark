import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const dist = resolve(projectRoot, 'dist');
const assets = [
  'index.html',
  'app.js',
  'native-google-sync.js',
  'style.css',
  'syukujitsu.csv',
  'manifest.webmanifest',
  'service-worker.js',
  'icons'
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const asset of assets) {
  await cp(resolve(projectRoot, asset), resolve(dist, asset), { recursive: true });
}
