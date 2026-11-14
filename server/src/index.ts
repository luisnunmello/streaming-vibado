import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { buildApi } from './api.js';
import { BudgetManager } from './budget.js';
import { config } from './config.js';
import { LiveService } from './live.js';
import { ensureMainRoom, purgePublicRooms } from './rooms.js';
import { initSettings } from './settings.js';
import { revokeGuestSessions } from './auth.js';
import { dueInvites, markEnded } from './invites.js';
import { startAppealReminders } from './notify.js';
import { startSfu } from './sfu.js';

const generated = initSettings();
if (generated) {
  console.log('\n================================================================');
  console.log(` First run: master password generated: ${generated}`);
  console.log(' Sign in as "admin" at /login and change it. (Reset: see README)');
  console.log('================================================================\n');
}
ensureMainRoom();
purgePublicRooms();

const app = express();
if (config.trustProxy) app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
app.disable('x-powered-by');
const smallJson = express.json({ limit: '16kb' });
// Bug reports may carry a (shrunk) screenshot as base64, so that one route reads a bigger body.
const bugJson = express.json({ limit: '600kb' });
app.use((req, res, next) => (req.method === 'POST' && req.path === '/api/bugs' ? bugJson : smallJson)(req, res, next));

const server =
  config.tls.key && config.tls.cert
    ? https.createServer({ key: fs.readFileSync(config.tls.key), cert: fs.readFileSync(config.tls.cert) }, app)
    : http.createServer(app);
const io = new Server(server, { serveClient: false });

const sfu = await startSfu();
const live = new LiveService(io, sfu);
const budget = new BudgetManager(live);
live.budget = budget;
live.attach();
budget.start();
// Temporary invites end by themselves: the guest is disconnected and their stream stops.
setInterval(() => {
  for (const inv of dueInvites()) {
    markEnded(inv.id);
    revokeGuestSessions(inv.id);
  }
}, 15_000).unref();
startAppealReminders(Number(process.env['APPEAL_REMINDER_HOURS'] ?? 12));

app.use('/api', buildApi(live, budget));

// ---- static client (production) ----
if (fs.existsSync(path.join(config.clientDir, 'index.html'))) {
  app.use(express.static(config.clientDir, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/socket.io')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.clientDir, 'index.html'));
  });
} else {
  console.log(`[http] client build not found at ${config.clientDir}; run it with "ng serve" (dev proxy) or build it.`);
}

server.listen(config.port, () => {
  console.log(`[http] listening on ${config.tls.key ? 'https' : 'http'}://0.0.0.0:${config.port}`);
});

const shutdown = () => {
  console.log('Shutting down...');
  budget.stop();
  io.close();
  sfu.worker.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
