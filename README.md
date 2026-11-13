# Streaming

Screen sharing in the browser through an **SFU** (not peer-to-peer): a streamer publishes one stream to the server, and the server forwards it to every viewer.

- **Backend:** Express + [mediasoup](https://mediasoup.org) (SFU) + socket.io signaling + SQLite, TypeScript
- **Frontend:** Angular
- **Accounts:** the admin (master password) invites **users** with activation keys. Users create public or private rooms, stream in them, and can invite others with referral keys. Viewers need no account.

```
streamer browser ──WebRTC──▶ mediasoup (server) ──WebRTC──▶ viewer browsers
        └──── HTTPS / socket.io signaling via Express (behind nginx) ────┘
```

## Pages

| Address | Who | What |
|---|---|---|
| `/` | everyone | Home: links to the main stream, public rooms, sign-in and key activation |
| `/lobbies` | everyone | Public rooms, live ones first |
| `/r/<room>` | everyone | Watch a room. Private rooms need their secret link (`/r/<room>?key=…`) |
| `/r/main` | everyone | The admin's permanent room |
| `/login`, `/activate` | everyone | Sign in; activate an account with a key |
| `/dashboard/rooms` | admin, users | Create, rename, make public/private, copy link, new secret link, stop, delete |
| `/dashboard/rooms/<room>` | room owner | **Studio**: stream into the room |
| `/dashboard/referrals` | users with referrals | Create and revoke referral keys |
| `/dashboard/account` | admin, users | Change password, see your limits and usage |
| `/dashboard/users` | admin | Create users, give them a limit preset (or custom limits), edit referrals, reset passwords, disable, delete |
| `/dashboard/presets` | admin | Limit presets: create, edit (users on the preset update at once), choose the default, delete |
| `/dashboard/bandwidth` | admin | Live traffic, active rooms, protection settings, pause switch |

## Run locally (development)

Requires Node 22.13 or newer. Two terminals:

```bash
npm run install:all        # once
npm run dev:server         # http://localhost:3000  (prints the generated admin password on first run)
npm run dev:client         # http://localhost:4200  (proxies /api and /socket.io to :3000)
```

Open `http://localhost:4200/login` and sign in as **`admin`** with the printed password.
Screen capture only works on `localhost` or HTTPS, so use `localhost` (not a LAN address) for the streaming page.

Testing from another device on your LAN: the server announces your LAN IP to browsers automatically. If it picks the wrong network adapter, set `MEDIASOUP_ANNOUNCED_IP`. Viewing works over plain HTTP; streaming from a non-localhost address needs HTTPS.

Tests: `npm --prefix server test` starts the real server against a temporary database and checks accounts, keys, referrals, limits, rooms and the per-IP cap.

## Accounts, keys and referrals

1. **Admin** signs in as `admin` with the master password (change it under *Account*).
2. **Admin → Users → New user:** enter a name, how many referrals the user may create, and (optionally) their limits. The server generates a random key such as `K7QM-2XWD-9PFA-R4TN`, shown **once**. Send it, or the activation link, to the person. Keys expire after 7 days and can be reissued.
3. **The user** opens the link (or `/activate`), enters the key and **chooses their own password**. They then sign in with their name and that password.
4. **Referrals:** a user with a referral quota creates keys under *Referrals*. Each key lets one person create an account (they choose their own name and password). Revoking an unused key frees the slot; keys expire after 14 days.
5. **Invited users** cannot invite anyone, and their limits can never exceed those of the user who invited them. Disabling a user can optionally disable everyone they invited.
6. **Forgot a password?** Users: *Users → Edit → Reset password* gives a new activation key. Admin: see below.

Keys are stored hashed, so they cannot be shown again after creation. Activation attempts are rate-limited.

## Rooms

- A room has a stable address and exists until its owner deletes it; it is "live" while the owner streams.
- **Public** rooms are listed in `/lobbies`. **Private** rooms are unlisted and reachable only through their **secret link**. Generating a new link kills the old one and removes current viewers.
- The owner (or the admin) can rename, change visibility, stop a stream, or delete the room. The admin can manage every room.

## Limits and bandwidth protection

Each user has limits (rooms, simultaneous streams, bitrate, resolution, frame rate, viewers per room, stream length, public rooms, audio, monthly traffic), enforced on the server.

**Limit presets.** Limits are organised in named presets (*Presets* page), for example "Small", "Friends", "Trusted". A user *follows* a preset: change the preset and every user on it gets the new limits **immediately**, including in their open studio and on their running stream. New and invited users start on the preset marked *default*. A single user can instead be given **custom limits** (they stop following any preset); choosing a preset for them again links them back. Deleting a preset leaves its users on their current limits as custom values.

**Limits change in real time.** When limits change, the user's open studio updates on its own (controls, maximums and the "Your limits" card), values above the new maximum are pulled down, and a stream in progress is adjusted: the bitrate ceiling is tightened, audio is switched off if it is no longer allowed, the time limit is recalculated and, if fewer simultaneous streams are allowed, the most recently started ones end.

The server also protects your connection as a whole: an upload budget with admission control, a share reserved for the admin, hard bitrate caps, adaptive quality layers, pausing hidden tabs, idle and time limits, per-IP caps, monthly quotas, a pause switch and live monitoring.

**All of it is explained in [docs/bandwidth-protection.md](docs/bandwidth-protection.md).** Set the upload budget to about 70% of your real uplink before opening the server to users.

## Streaming (studio)

- **Video quality** (changeable while live): presets, frame rate, resolution, bitrate, and what to sacrifice when the machine or network can't keep up (*Keep smooth* drops resolution first, best for games; *Keep sharp* drops frame rate first, best for text). Users are limited to their maximums.
- **Codec** (set at start): H.264 is usually hardware-encoded (lowest CPU, best for 60 fps) and is sent as Constrained Baseline, the profile every browser accepts. If some viewer's browser cannot decode it (for example a Firefox without OpenH264), use **VP8**, which plays everywhere. VP9/AV1 give better quality per Mbps but use more CPU. Users default to VP8.
- **Adaptive quality** (set at start): sends three quality levels so the server can lower quality for viewers instead of refusing them. On by default for users.
- **Audio:** screen audio (all / shared window only), plus an optional extra input (mic or virtual cable) mixed in, with volume sliders and a mute switch that work live.
- **Change the shared window without stopping:** the *Change screen / window* button opens the picker again and swaps the picture (and screen audio) on the same connection. Viewers keep watching without interruption.
- **Live stats:** sent bitrate, fps, resolution, encode time, packet loss, RTT, and whether the encoder is limited by CPU or bandwidth.

**Excluding specific apps from the audio:** browsers can't pick individual apps. Use *Shared window only* (Chrome/Edge on Windows), or install a virtual audio cable (e.g. VB-CABLE), route only the wanted apps to it in the Windows volume mixer, and select it as the extra input with screen audio set to *No screen audio*.

**Viewers** get just the video, a click-to-unmute button (browsers block autoplay with sound), volume, fullscreen, a *Quality* menu when the stream offers levels, and a small optional *Stats* readout.

## Deploy with Docker

```bash
git clone <your repo> && cd streaming
cp .env.example .env       # set MEDIASOUP_ANNOUNCED_IP to the server's public IP
docker compose up -d --build
docker compose logs         # shows the generated master password on first start
```

1. **Open the video port** in the firewall / cloud security group: `RTC_PORT` (default **40000**) for **both UDP and TCP**. All WebRTC traffic uses this single port. UDP is the main path; TCP is a slower fallback for viewers whose network blocks UDP. nginx is not involved in the video.
2. **nginx + certbot** for HTTPS: see [deploy/nginx.conf.example](deploy/nginx.conf.example) (includes the WebSocket upgrade headers), then `certbot --nginx -d your.domain`. The container listens on `127.0.0.1:3000` only.
3. Sign in at `https://your.domain/login` as `admin` and **change the master password** under *Account*.
4. On the *Bandwidth* page, set the upload budget to about 70% of your real upload speed.

HTTPS is required for anyone who streams (browsers only allow screen capture on secure origins). Viewers work over plain HTTP too, but use HTTPS anyway.

> On a busy Linux server, Docker's UDP port forwarding adds CPU overhead. [docker-compose.yml](docker-compose.yml) has a commented `network_mode: host` option that avoids it.

### Updating

```bash
./scripts/update.sh              # git pull, rebuild image, restart, wait until healthy
./scripts/update.sh --rollback   # return to the previous image if the update misbehaves
```

An update restarts the container, which **ends all streams** and signs everyone out. Viewers reconnect automatically and streamers start again. Accounts, rooms, limits and traffic totals live in the `streaming-data` volume and survive updates; an existing master password is kept.

### Without Docker

```bash
npm run install:all && npm run build
ADMIN_PASSWORD=... MEDIASOUP_ANNOUNCED_IP=<public ip> TRUST_PROXY=1 npm start
```

Use a process manager (systemd, pm2) to keep it running. Node 22.13+ is required (the database is Node's built-in SQLite).

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port (web + signaling) |
| `RTC_PORT` | `40000` | WebRTC port, UDP + TCP |
| `MEDIASOUP_ANNOUNCED_IP` | LAN IP | Address browsers send video to. **Set to the public IP in production.** |
| `RTC_LISTEN_IP` | `0.0.0.0` | Interface to bind |
| `ADMIN_PASSWORD` | generated | Master password, used only the first time |
| `TRUST_PROXY` | – | Set to `1` behind nginx so rate limiting and the per-IP cap see real client IPs |
| `DATA_DIR` | `server/data` (`/data` in Docker) | Database and settings |
| `EGRESS_BUDGET_MBPS` | `500` | Starting upload budget (later edited on the Bandwidth page) |
| `INGRESS_BUDGET_MBPS` | `800` | Starting download budget |
| `RTC_INITIAL_BITRATE` | `8000000` | Starting bandwidth estimate per viewer (bps), so quality ramps up fast |
| `RTC_MAX_INCOMING_BITRATE` | `60000000` | Cap on what the admin may send (bps) |
| `TLS_KEY`, `TLS_CERT` | – | Optional built-in HTTPS without nginx |

Budgets set on the *Bandwidth* page are stored in the database and take precedence over the environment values from then on.

**Forgot the master password?**

- Without Docker: `npm --prefix server run reset-password -- "new password"` (no restart needed).
- With Docker: `docker compose exec streaming rm /data/settings.json && docker compose restart`. On the next start a new password is taken from `ADMIN_PASSWORD` in `.env`, or generated and printed in `docker compose logs`. Users and rooms are not affected.

## Capacity

Server upload ≈ `viewers × bitrate`. At 1080p60 (~10 Mbps) a 500 Mbps budget serves roughly 45 viewers. One mediasoup worker (one CPU core) handles all media forwarding; spreading rooms over several cores is the natural next step when you need hundreds of viewers.

## Status and known limits

This is still a prototype.

- Verified with Chrome automation (fake capture source), directly and in Docker: sign-in, key activation, referrals, private/public rooms, streaming with three quality levels, viewer quality switching, limits, per-IP cap, disabling a user while live, and the bandwidth page. Not yet verified with real high-motion content, many simultaneous viewers, or over the real internet. Check the *Encoder limit* indicator when tuning.
- Sessions are kept in memory: a restart signs everyone out.
- A room has one streamer at a time, and the streamer's room must be open in only one window.
- Screen capture and audio options need a desktop Chromium-based browser (Chrome, Edge). System/window audio capture depends on OS and browser support.
- A 4K display is captured at native size and downscaled by the browser, which costs CPU; if frames drop, check the encode time in the live stats.
