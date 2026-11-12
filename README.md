# Streaming

Screen sharing in the browser through an **SFU** (not peer-to-peer): the admin publishes one stream to the server, and the server forwards it to every viewer.

- **Backend:** Express + [mediasoup](https://mediasoup.org) (SFU) + socket.io signaling, TypeScript
- **Frontend:** Angular (viewer page at `/`, admin page at `/admin`)
- Only the admin can stream. Viewers need no login.

```
admin browser ──WebRTC──▶ mediasoup (server) ──WebRTC──▶ viewer browsers
        └──── HTTPS / socket.io signaling via Express (behind nginx) ────┘
```

## Run locally (development)

Requires Node 22+. Two terminals:

```bash
npm run install:all        # once
npm run dev:server         # http://localhost:3000  (prints the generated admin password on first run)
npm run dev:client         # http://localhost:4200  (proxies /api and /socket.io to :3000)
```

Open `http://localhost:4200/admin` to stream and `http://localhost:4200/` to watch.
Screen capture only works on `localhost` or HTTPS.

Testing from another device on your LAN: the server announces your LAN IP to browsers automatically. If it picks the wrong network adapter, set `MEDIASOUP_ANNOUNCED_IP`.

## Deploy with Docker

```bash
git clone <your repo> && cd streaming
cp .env.example .env       # set MEDIASOUP_ANNOUNCED_IP to the server's public IP
docker compose up -d --build
docker compose logs         # shows the generated master password on first start
```

1. **Open the video port** in the firewall / cloud security group: `RTC_PORT` (default **40000**) for **both UDP and TCP**. All WebRTC traffic uses this single port. UDP is the main path; TCP is a slower fallback for viewers whose network blocks UDP. nginx is not involved in the video.
2. **nginx + certbot** for HTTPS: see [deploy/nginx.conf.example](deploy/nginx.conf.example) (includes the WebSocket upgrade headers), then `certbot --nginx -d your.domain`. The container listens on `127.0.0.1:3000` only.
3. Sign in at `https://your.domain/admin` and **change the master password** on that page.

HTTPS is required for the admin page (browsers only allow screen capture on secure origins). Viewers work over plain HTTP too, but use HTTPS anyway.

> On a busy Linux server, Docker's UDP port forwarding adds CPU overhead. [docker-compose.yml](docker-compose.yml) has a commented `network_mode: host` option that avoids it.

### Updating

```bash
./scripts/update.sh              # git pull, rebuild image, restart, wait until healthy
./scripts/update.sh --rollback   # return to the previous image if the update misbehaves
```

An update restarts the container, which **ends the current broadcast**. Viewers reconnect automatically and the streamer presses *Start streaming* again. The master password and settings live in the `streaming-data` volume and survive updates.

### Without Docker

```bash
npm run install:all && npm run build
ADMIN_PASSWORD=... MEDIASOUP_ANNOUNCED_IP=<public ip> TRUST_PROXY=1 npm start
```

Use a process manager (systemd, pm2) to keep it running.

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port (web + signaling) |
| `RTC_PORT` | `40000` | WebRTC port, UDP + TCP |
| `MEDIASOUP_ANNOUNCED_IP` | LAN IP | Address browsers send video to. **Set to the public IP in production.** |
| `RTC_LISTEN_IP` | `0.0.0.0` | Interface to bind |
| `ADMIN_PASSWORD` | generated | Master password, used only on first start |
| `TRUST_PROXY` | – | Set to `1` behind nginx so login rate limiting sees real client IPs |
| `DATA_DIR` | `server/data` (`/data` in Docker) | Where the password hash is stored |
| `RTC_INITIAL_BITRATE` | `8000000` | Starting bandwidth estimate per viewer (bps), so quality ramps up fast |
| `RTC_MAX_INCOMING_BITRATE` | `60000000` | Cap on what the streamer may send (bps) |
| `TLS_KEY`, `TLS_CERT` | – | Optional built-in HTTPS without nginx |

**Forgot the password?**

- Without Docker: `npm --prefix server run reset-password -- "new password"` (no restart needed).
- With Docker: `docker compose exec streaming rm /data/settings.json && docker compose restart`. On the next start a new password is used from `ADMIN_PASSWORD` in `.env`, or generated and printed in `docker compose logs`.

## Using it

**Admin (`/admin`)**

- **Video quality** (changeable while live): presets, frame rate (30/60/120), output resolution, bitrate (1–40 Mbps), and what to sacrifice when the machine or network can't keep up (*Keep smooth* = drop resolution first, best for games; *Keep sharp* = drop frame rate first, best for text).
- **Codec** (set at start): H.264 is usually hardware-encoded (lowest CPU, best for 60 fps); VP8/VP9/AV1 give better quality per Mbps but use more CPU.
- **Audio:** screen audio (all / shared window only), plus an optional extra input (mic or virtual cable) mixed in, with volume sliders and a mute switch that work live.
- **Live stats:** sent bitrate, fps, resolution, encode time, packet loss, RTT, and whether the encoder is limited by CPU or bandwidth.
- **Master password:** change it from the same page. Other admin sessions are signed out.

**Excluding specific apps from the audio:** browsers can't pick individual apps. Use *Shared window only* (Chrome/Edge on Windows), or install a virtual audio cable (e.g. VB-CABLE), route only the wanted apps to it in the Windows volume mixer, and select it as the extra input with screen audio set to *No screen audio*.

**Viewer (`/`)**: just the video, a click-to-unmute button (browsers block autoplay with sound), volume, fullscreen and a small optional *Stats* readout.

## Capacity

Server upload ≈ `viewers × bitrate`. At 1080p60 (~10 Mbps) a 500 Mbps uplink serves roughly 45 viewers. The admin page shows the current estimate. One mediasoup worker (one CPU core) handles the media forwarding; spreading viewers over several cores (`router.pipeToRouter`) is the natural next step when you need hundreds of viewers.

## Status and known limits

This is a prototype.

- Verified with Chrome automation (fake capture source): login, password change, start/stop, live quality changes, audio mixing, and viewer playback, both directly and in Docker. Not yet verified with real high-motion content or over the real internet. Check the *Encoder limit* indicator when tuning.
- One stream and one streamer at a time (a second admin session is refused while someone is streaming).
- Viewers receive a single quality layer; there is no simulcast/adaptive quality yet.
- Screen capture and audio options need a desktop Chromium-based browser (Chrome, Edge). System/window audio capture depends on OS and browser support.
- A 4K display is captured at native size and downscaled by the browser, which costs CPU; if frames drop, check the encode time in the live stats.
