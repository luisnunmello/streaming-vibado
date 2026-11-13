import { createWorker, types } from 'mediasoup';
import { config } from './config.js';

const mediaCodecs: types.RouterRtpCodecCapability[] = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
  { kind: 'video', mimeType: 'video/VP9', clockRate: 90000, parameters: { 'profile-id': 0 } },
  { kind: 'video', mimeType: 'video/AV1', clockRate: 90000 },
  // H.264 is usually hardware-encoded in browsers: lowest CPU on the streamer machine.
  ...['42e01f', '4d001f', '640c1f'].map(
    (level): types.RouterRtpCodecCapability => ({
      kind: 'video',
      mimeType: 'video/H264',
      clockRate: 90000,
      parameters: {
        'packetization-mode': 1,
        'profile-level-id': level,
        'level-asymmetry-allowed': 1,
      },
    }),
  ),
];

export interface Sfu {
  worker: types.Worker;
  webRtcServer: types.WebRtcServer;
  /** Every room gets its own router, so rooms are isolated and cleaned up independently. */
  createRouter(): Promise<types.Router>;
}

export async function startSfu(): Promise<Sfu> {
  const worker = await createWorker({ logLevel: 'warn' });
  worker.on('died', () => {
    console.error('mediasoup worker died, exiting');
    process.exit(1);
  });

  const { listenIp, port, announcedIp } = config.rtc;
  const webRtcServer = await worker.createWebRtcServer({
    listenInfos: [
      { protocol: 'udp', ip: listenIp, announcedAddress: announcedIp, port },
      { protocol: 'tcp', ip: listenIp, announcedAddress: announcedIp, port },
    ],
  });
  console.log(`[sfu] mediasoup worker ${worker.pid} ready, WebRTC on ${listenIp}:${port} (udp+tcp), announced ${announcedIp}`);
  return { worker, webRtcServer, createRouter: () => worker.createRouter({ mediaCodecs }) };
}
