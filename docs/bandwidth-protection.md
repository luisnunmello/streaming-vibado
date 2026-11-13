# Bandwidth protection

Everything the server does so that users cannot use up your connection. Read this before changing limits.

## The problem

The server uploads one copy of a stream to **every viewer**, so the load is

```
upload  ≈  viewers × stream bitrate     (added up over all rooms)
```

A single 5 Mbps stream watched by 100 people needs 500 Mbps. Anyone who can create rooms can therefore consume your uplink unless something stops them. The measures below work in layers: some prevent a stream from starting, some cap what a stream can use, and some react when the server is busy.

Where numbers are shown as *settings*, they are on the **Bandwidth** page (admin) unless noted. Per-user limits are on the **Users** page.

## Summary

| # | Measure | Stops | Configured in |
|---|---|---|---|
| 1 | Upload budget with admission control | Total upload above what you can afford | Bandwidth → *Upload budget* |
| 2 | Share kept for the admin | Users squeezing out your own streams | Bandwidth → *Kept for the admin* |
| 3 | Download budget | Too many streams being sent to the server | Bandwidth → *Download budget* |
| 4 | Hard bitrate cap per user | A user sending more than allowed | User limit *Max bitrate* |
| 5 | Per-user limits | Rooms, streams, quality, length, features | User limits |
| 6 | Viewer cap per room | One room growing without bound | User limit *Max viewers per room* |
| 7 | Quality layers (adaptive quality) | Refusing viewers when you could serve them less | Studio → *Adaptive quality*; viewer menu |
| 8 | Pause for hidden tabs | Sending video nobody is looking at | Automatic |
| 9 | Idle stop | Streams nobody watches | Bandwidth → *Stop user streams with no viewers* |
| 10 | Maximum stream length | Streams that never end | User limit *Max stream length* |
| 11 | Connections per IP | One person opening many viewers | Bandwidth → *Viewer connections per IP* |
| 12 | Monthly traffic quota | Heavy users on metered hosting | User limit *Monthly traffic* |
| 13 | Pause switch | Emergencies | Bandwidth → *Pause all user streams* |
| 14 | Live monitoring | Not noticing a problem | Bandwidth page |

## 1. Upload budget and admission control

*Setting:* `egressBudgetMbps` (default 500; starting value from `EGRESS_BUDGET_MBPS`).

Every 3 seconds the server measures the **real** bytes it sent to viewers (from the WebRTC transports), for all rooms. When a viewer wants to start receiving video, the server checks:

```
measured upload + admitted since the last measurement + cost of this viewer  ≤  budget
```

The *cost of this viewer* is the current bitrate of the room's incoming video (one quality level) plus audio. If the room has not been measured yet, the owner's maximum bitrate is used (8 Mbps for the admin).

If it does not fit, the viewer sees *"The server is at full capacity right now"* and their player retries every 10 seconds, so they get in as soon as there is room. Viewers already watching are never dropped by this rule.

**Choosing the number:** measure your real upload with `iperf3 -R` (see the README) and use about **70%** of it. The rest is headroom for retransmissions, protocol overhead, the web traffic itself and bursts between measurements.

## 2. Share kept for the admin

*Setting:* `adminReservePct` (default 30).

Users can only use `budget × (1 − reserve)`. With the defaults that is 350 of 500 Mbps. The admin's own rooms may use the whole budget. So even if users fill their share, your streams can still accept viewers.

## 3. Download budget

*Setting:* `ingressBudgetMbps` (default 800; starting value from `INGRESS_BUDGET_MBPS`).

Streams also have to arrive. A new user stream is allowed to start only if

```
measured download + the stream's maximum bitrate  ≤  download budget
```

Otherwise the user is told the server cannot take another stream right now and can try again later.

## 4. Hard bitrate cap per user

The server tells the network layer of each user's connection to drop anything above

```
1.7 × the user's max bitrate + 0.3 Mbps
```

This is enforced **on the server**, so a modified browser cannot exceed it. The 1.7× is room for the extra quality levels of adaptive streams (about 1.55× the main stream) plus audio. The studio page also limits the controls to the user's maximum, so honest users never hit this.

## 5. Per-user limits

Each user has these limits. They come from a **limit preset** the user follows (*Presets* page; new users start on the default preset), or are custom for that user. Invited users can never get more than the person who invited them: their limits are capped by the inviter's, and that cap follows later changes. The admin can change any of them at any time.

**Changes take effect immediately.** Editing a preset (or a user's limits) updates every affected user at once, without them reloading anything: their studio gets the new maximums, and what is already running is adjusted. The bitrate ceiling of their connection is changed, audio is switched off if it is no longer allowed, the stream-length timer is recalculated (a stream already past the new limit ends), and if fewer simultaneous streams are allowed the most recently started ones end. Viewers already in a room stay even if the viewer cap is lowered; the new cap applies to people joining afterwards.

| Limit | Meaning | Default |
|---|---|---|
| Max rooms | Rooms the user can own | 3 |
| Streams at the same time | Rooms live simultaneously | 1 |
| Max bitrate | Cap for the main video (Mbps) | 3 |
| Max resolution / frame rate | Studio controls are limited to these | 720p / 30 fps |
| Max viewers per room | See 6 | 10 |
| Max stream length | Minutes; 0 = unlimited | 120 |
| May create public rooms | Public rooms appear in the lobby | yes |
| May stream audio | Audio streams are refused if off | yes |
| Monthly traffic | GB delivered to viewers; 0 = unlimited | 0 |

Resolution and frame rate are limited in the studio controls (and follow live changes), and the bitrate cap (4) is what the server enforces for them. Because resolution and frame rate only affect how efficiently the bitrate is used, the bitrate cap is what actually protects your bandwidth.

## 6. Viewer cap per room

A room accepts at most *Max viewers per room* viewers; the next one sees *"This room is full"*. Viewers waiting on an offline room count too. Counting is done when joining, so it also stops people from parking in a room.

## 7. Quality layers (adaptive quality)

When the streamer enables **Adaptive quality**, the browser sends **three versions** of the stream: full size, half size and quarter size (at roughly 100%, 40% and 15% of the bitrate). The server forwards just one of them to each viewer. For VP9/AV1 the same effect is achieved with scalable video coding.

This gives three tools:

- **Viewer choice.** Viewers of such a stream get a *Quality* menu: Auto, High, Medium, Low. A viewer on a phone can pick Low and cost you about a sixth of the bandwidth.
- **Automatic degradation under pressure.** Every 3 seconds the server compares upload with the budget. If user upload is above **95%** of the users' share, or total upload is above **95%** of the budget, user viewers are capped one level lower (High → Medium → Low). When load falls below **70%** (users) and **80%** (total) for three checks in a row, they go back up one level. This keeps everyone watching, at lower quality, instead of refusing new viewers.
- **The admin's streams are never degraded** by this rule.

Limitations: it only applies to streams started with Adaptive quality. Users default to it being on; the admin's streams default to off because it costs extra CPU on the streaming machine (three encodes instead of one). Without layers the server can only refuse new viewers (1), not lower quality for existing ones.

## 8. Pause for hidden tabs

If a viewer's tab is hidden for 10 seconds, the player tells the server to stop sending video. Sending resumes the moment the tab is visible again. Audio keeps playing. This removes the traffic of every forgotten background tab at no cost to anyone.

## 9. Idle stop

A user stream with **no viewers** for *N* minutes (default 30) is ended. The streamer sees why and can start again. This catches streams left running by accident. The admin's streams are exempt.

## 10. Maximum stream length

A user's stream is ended after *Max stream length* minutes (default 120; 0 = unlimited). The streamer gets a message and can start a new one.

## 11. Connections per IP

At most *N* viewer connections per IP address (default 4; 0 = unlimited) can be open at once. Owners (people streaming) are exempt. When running behind nginx, set `TRUST_PROXY=1` so the real client address is used, otherwise every viewer appears to come from the proxy and the limit would apply to everyone together.

Many people behind one office or school network share an address; raise the value if that is your audience.

## 12. Monthly traffic quota

If a user has *Monthly traffic* set, the server adds up the bytes sent to viewers of their rooms. When the quota is reached the user's streams end and new ones are refused until next month (UTC calendar months). The page *Account* shows the user their usage; *Users* shows it to you.

Counting is done from the actual network transports every 3 seconds and saved every 30 seconds, so at most about 30 seconds of traffic can be lost if the server is killed.

## 13. Pause switch

*Pause all user streams* ends every user stream immediately and blocks new ones until you press *Resume*. The admin's own streams are not affected. Use it if something is going wrong and you need your connection back right now.

## 14. Live monitoring

The **Bandwidth** page updates every 2 seconds and shows:

- upload and download against their budgets, split into admin and users, with the users' limit marked
- a warning above 80% of the upload budget, and when users have been moved to a lower quality level
- every active room with owner, viewers, upload and download, and a **Stop** button

## Choosing numbers: an example

Your measured upload is about 745 Mbps, so:

| Setting | Value | Why |
|---|---|---|
| Upload budget | 500 Mbps | about 70% of 745 |
| Kept for the admin | 30% | users share 350 Mbps |
| User defaults | 720p30, 3 Mbps, 10 viewers | a full user room uses about 30 Mbps |

That allows roughly **11 completely full user rooms** at the same time, plus your own streams. If you give a user 6 Mbps and 50 viewers, one room alone can use 300 Mbps, so raise limits one user at a time.

## What this does not protect against

- **Attacks.** These measures limit what legitimate accounts can do. They are not a defence against floods or denial-of-service attacks; use your provider's protection and a firewall for that.
- **Instant spikes.** Measurements are taken every 3 seconds. A burst of viewers inside one interval is counted from what was admitted, but a sudden change in how much a stream needs can briefly exceed the budget. That is why the budget should be well below your real uplink.
- **CPU.** One CPU core (one mediasoup worker) forwards all the media. Before bandwidth runs out, a very small server may run out of CPU. Watch CPU while you load-test.
- **Quality of the encoder on the user's side.** Limits cap bitrate; they cannot make a weak computer produce smooth video.
- **Restarts.** Sessions and live measurements are kept in memory. A restart signs people out and ends all streams. Accounts, rooms, limits and traffic totals are in the database and survive.
