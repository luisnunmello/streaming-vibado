import fs from 'node:fs';

/** The app version: server/package.json (src/ and dist/ are both one level below it). Kept equal to the client's by scripts/bump-version.mjs. */
export const APP_VERSION: string = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();
