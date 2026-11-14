import pkg from '../../../package.json';

/** The app version, from client/package.json (kept equal to the server's by scripts/bump-version.mjs). */
export const APP_VERSION: string = pkg.version;
