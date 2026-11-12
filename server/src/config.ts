import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function lanIp(): string {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return '127.0.0.1';
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  /** Set to 1 when running behind nginx so req.ip / rate limiting use X-Forwarded-For. */
  trustProxy: process.env.TRUST_PROXY ?? '',
  dataDir: process.env.DATA_DIR ?? path.resolve(here, '..', 'data'),
  clientDir: process.env.CLIENT_DIR ?? path.resolve(here, '..', '..', 'client', 'dist', 'client', 'browser'),
  tls: {
    key: process.env.TLS_KEY,
    cert: process.env.TLS_CERT,
  },
  rtc: {
    /** Single port used for all WebRTC traffic (UDP + TCP). Must be reachable from viewers. */
    port: Number(process.env.RTC_PORT ?? 40000),
    listenIp: process.env.RTC_LISTEN_IP ?? '0.0.0.0',
    /** Public IP (or LAN IP for local testing) announced to browsers. */
    announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP ?? lanIp(),
    /** Starting estimate for the server->viewer bitrate, so quality ramps up fast. */
    initialOutgoingBitrate: Number(process.env.RTC_INITIAL_BITRATE ?? 8_000_000),
    /** Cap on what the streamer may send. */
    maxIncomingBitrate: Number(process.env.RTC_MAX_INCOMING_BITRATE ?? 60_000_000),
  },
};
