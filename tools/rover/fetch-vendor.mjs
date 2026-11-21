// Downloads the game's libraries into static/rover/vendor/ (minified when esbuild is installed).
// Run after changing a version below:   npm run rover:vendor
//
// Two Three.js builds are kept side by side so a new version can be rolled back:
//   index.html picks one with THREE_DEFAULT, and /rover/?three=128 loads the other for comparison.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VENDOR = path.join(ROOT, 'static', 'rover', 'vendor');
const CDN = 'https://cdn.jsdelivr.net/npm';
const FILES = {
  'three-r187/three.module.js': `${CDN}/three@0.187.0/build/three.module.js`,
  'three-r187/three.core.js': `${CDN}/three@0.187.0/build/three.core.js`,
  'three-r187/LICENSE': `${CDN}/three@0.187.0/LICENSE`,
  'three-r128/three.module.js': `${CDN}/three@0.128.0/build/three.module.js`,
  'three-r128/LICENSE': `${CDN}/three@0.128.0/LICENSE`,
  'geotiff.js': `${CDN}/geotiff@2.1.3/dist-browser/geotiff.js`,
};

let esbuild = null;
try {
  const require = createRequire(import.meta.url);
  esbuild = require(require.resolve('esbuild', { paths: [ROOT] }));
} catch { /* not installed: files are saved unminified */ }

for (const [name, url] of Object.entries(FILES)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  let text = await res.text();
  if (esbuild && name.startsWith('three-') && name.endsWith('.js')) {
    text = (await esbuild.transform(text, { minify: true, legalComments: 'inline' })).code;
  }
  const out = path.join(VENDOR, name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  console.log(`${name}  ${(text.length / 1024).toFixed(0)} KB`);
}
if (!esbuild) console.log('Tip: npm i --no-save esbuild first to minify Three.js (about half the size).');
