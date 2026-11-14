// Downloads mediasoup's prebuilt worker binary, like mediasoup's own install step, but never hangs:
// IPv4 first, a hard timeout per attempt, retries, and a log line for every step.
// Run from node_modules/mediasoup:  node /path/to/fetch-mediasoup-worker.mjs
// Set MEDIASOUP_WORKER_PREBUILT_DOWNLOAD_BASE_URL to use a mirror of github.com/versatica/mediasoup/releases/download.
import { execFileSync, execSync } from 'node:child_process';
import dns from 'node:dns';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

dns.setDefaultResultOrder('ipv4first');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const kernel = os.platform() === 'linux' ? `-kernel${Number(os.release().split('.')[0])}` : '';
const name = `mediasoup-worker-${pkg.version}-${os.platform()}-${os.arch()}${kernel}.tgz`;
const base = process.env.MEDIASOUP_WORKER_PREBUILT_DOWNLOAD_BASE_URL || 'https://github.com/versatica/mediasoup/releases/download';
const url = `${base}/${pkg.version}/${name}`;
const outDir = path.resolve('worker/out/Release');
const bin = path.join(outDir, os.platform() === 'win32' ? 'mediasoup-worker.exe' : 'mediasoup-worker');
const log = (...a) => console.log('[mediasoup-worker]', ...a);

log(`downloading ${url}`);
fs.mkdirSync(outDir, { recursive: true });

let ok = false;
for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: 'follow' });
    log(`attempt ${attempt}: HTTP ${res.status} from ${new URL(res.url).host} after ${Date.now() - started} ms`);
    if (res.status === 404) throw new Error(`no prebuilt worker named ${name} (this CPU/kernel combination has none)`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer()); // the same 60 s limit covers the body
    log(`attempt ${attempt}: got ${data.length} bytes`);
    fs.writeFileSync(path.join(outDir, name), data);
    execFileSync('tar', ['-xzf', name], { cwd: outDir }); // relative name: tar reads "C:\x" as a remote host
    fs.rmSync(path.join(outDir, name));
    fs.chmodSync(bin, 0o775);
    // Like mediasoup does: the worker started without its env must exit with code 41 if it runs on this host.
    try {
      execSync(`"${bin}"`, { stdio: 'ignore', env: {} });
    } catch (e) {
      if (e.status !== 41) throw new Error(`the downloaded worker does not run on this host (exit ${e.status})`);
    }
    ok = true;
  } catch (e) {
    log(`attempt ${attempt} failed after ${Date.now() - started} ms: ${e?.cause?.code ?? ''} ${e?.message ?? e}`);
    if (/no prebuilt/.test(String(e?.message))) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
}
if (!ok) {
  log('FAILED. Check that this machine can reach the URL above (and the host it redirects to: release-assets.githubusercontent.com).');
  process.exit(1);
}
log('worker ready');
