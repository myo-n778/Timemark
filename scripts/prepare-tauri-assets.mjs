import { access, cp, mkdir, readdir, rm } from 'node:fs/promises';
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

const iosIconSource = resolve(projectRoot, 'src-tauri', 'icons', 'ios');
const iosAppIconSet = resolve(projectRoot, 'src-tauri', 'gen', 'apple', 'Assets.xcassets', 'AppIcon.appiconset');

try {
  await access(iosAppIconSet);
  for (const iconFile of await readdir(iosIconSource)) {
    await cp(resolve(iosIconSource, iconFile), resolve(iosAppIconSet, iconFile), { force: true });
  }
} catch {
  // The iOS project has not been initialized yet. `tauri ios init` creates it.
}
