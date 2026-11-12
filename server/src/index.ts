import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Server } from 'socket.io';
import { config } from './config.js';
import { initSettings, setPassword, verifyPassword } from './settings.js';
import {
  createSession,
  destroySession,
  isValidSession,
  loginLockedFor,
  recordLogin,
  revokeAllExcept,
} from './auth.js';
import { startSfu } from './sfu.js';
import { registerSignaling } from './signaling.js';

const generated = initSettings();
if (generated) {
  console.log('\n================================================================');
  console.log(` First run: master password generated: ${generated}`);
  console.log(' Log in at /admin and change it. (Reset with: npm run reset-password)');
  console.log('================================================================\n');
}

const app = express();
if (config.trustProxy) app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
app.disable('x-powered-by');
app.use(express.json({ limit: '4kb' }));

const server =
  config.tls.key && config.tls.cert
    ? https.createServer({ key: fs.readFileSync(config.tls.key), cert: fs.readFileSync(config.tls.cert) }, app)
    : http.createServer(app);
const io = new Server(server, { serveClient: false });

// ---- socket auth: a valid admin token makes the socket an admin; otherwise it is a viewer ----
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  socket.data.isAdmin = isValidSession(token);
  socket.data.token = socket.data.isAdmin ? token : undefined;
  next();
});

// ---- API ----
const bearer = (req: Request): string | undefined => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
};

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!isValidSession(token)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.locals.token = token;
  next();
}

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip ?? 'unknown';
  const wait = loginLockedFor(ip);
  if (wait > 0) {
    res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(wait / 1000)}s.` });
    return;
  }
  const password = req.body?.password;
  const ok = typeof password === 'string' && password.length > 0 && password.length <= 256 && verifyPassword(password);
  recordLogin(ip, ok);
  if (!ok) {
    res.status(401).json({ error: 'Wrong password' });
    return;
  }
  res.json({ token: createSession() });
});

app.get('/api/admin/session', requireAdmin, (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/admin/logout', requireAdmin, (_req, res) => {
  const token: string = res.locals.token;
  destroySession(token);
  disconnectToken(token);
  res.json({ ok: true });
});

app.post('/api/admin/password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword)) {
    res.status(403).json({ error: 'Current password is wrong' });
    return;
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 256) {
    res.status(400).json({ error: 'New password must have 8 to 256 characters' });
    return;
  }
  setPassword(newPassword);
  // Sign every other admin session out; the one that changed the password stays valid.
  for (const revoked of revokeAllExcept(res.locals.token)) disconnectToken(revoked);
  res.json({ ok: true });
});

function disconnectToken(token: string) {
  for (const s of io.sockets.sockets.values()) {
    if (s.data.token === token) {
      s.emit('sessionRevoked');
      s.disconnect(true);
    }
  }
}

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

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

const sfu = await startSfu();
registerSignaling(io, sfu);

server.listen(config.port, () => {
  console.log(`[http] listening on ${config.tls.key ? 'https' : 'http'}://0.0.0.0:${config.port}`);
});

const shutdown = () => {
  console.log('Shutting down...');
  io.close();
  sfu.worker.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
