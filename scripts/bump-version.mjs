// Sets the app version in client/ and server/ (they must always match).
// Usage: node scripts/bump-version.mjs <patch|minor|major|x.y.z>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node scripts/bump-version.mjs <patch|minor|major|x.y.z>');
  process.exit(1);
}
const current = JSON.parse(fs.readFileSync(path.join(root, 'server', 'package.json'), 'utf8')).version;
let next = arg;
if (['patch', 'minor', 'major'].includes(arg)) {
  const [a, b, c] = current.split('.').map(Number);
  next = arg === 'major' ? `${a + 1}.0.0` : arg === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`Not a valid version: ${next}`);
  process.exit(1);
}
for (const dir of ['client', 'server']) {
  execFileSync('npm', ['version', next, '--no-git-tag-version', '--allow-same-version'], { cwd: path.join(root, dir), stdio: 'ignore', shell: process.platform === 'win32' });
}
console.log(`${current} -> ${next}`);
