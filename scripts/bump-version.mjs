// Sets the app version in client/src/app/core/version.ts and server/src/version.ts (they must always match).
// The version lives in source files, not package.json: editing package.json would make Docker redo `npm ci` on every deploy.
// Usage: node scripts/bump-version.mjs <patch|minor|major|x.y.z>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['server/src/version.ts', 'client/src/app/core/version.ts'].map((f) => path.join(root, f));
const re = /APP_VERSION = '(\d+\.\d+\.\d+)'/;
const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node scripts/bump-version.mjs <patch|minor|major|x.y.z>');
  process.exit(1);
}
const current = re.exec(fs.readFileSync(files[0], 'utf8'))?.[1];
if (!current) {
  console.error('Could not read the current version');
  process.exit(1);
}
let next = arg;
if (['patch', 'minor', 'major'].includes(arg)) {
  const [a, b, c] = current.split('.').map(Number);
  next = arg === 'major' ? `${a + 1}.0.0` : arg === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`Not a valid version: ${next}`);
  process.exit(1);
}
for (const f of files) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(re, `APP_VERSION = '${next}'`));
console.log(`${current} -> ${next}`);
