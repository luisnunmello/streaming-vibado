import type { Server, Socket } from 'socket.io';
import { types } from 'mediasoup';
import { config } from './config.js';
import type { Sfu } from './sfu.js';

type Ack = (res: { ok: true; [k: string]: unknown } | { ok: false; error: string }) => void;

/** Errors safe to show to the client (as opposed to unexpected internal errors). */
class ClientError extends Error {}

interface Peer {
  isAdmin: boolean;
  transports: Map<string, types.WebRtcTransport>;
  producers: Map<string, types.Producer>;
  consumers: Map<string, types.Consumer>;
}

export function registerSignaling(io: Server, sfu: Sfu) {
  const peers = new Map<string, Peer>();
  /** Socket id of the admin session that currently owns the stream. */
  let streamerId: string | null = null;
  const allProducers = new Map<string, types.Producer>();

  const isLive = () => [...allProducers.values()].some((p) => p.kind === 'video');
  const viewerCount = () => [...peers.values()].filter((p) => !p.isAdmin).length;
  const broadcastState = () => io.emit('streamState', { live: isLive() });
  const broadcastViewers = () => io.to('admin').emit('viewerCount', viewerCount());

  io.on('connection', (socket: Socket) => {
    const isAdmin = socket.data.isAdmin === true;
    const peer: Peer = { isAdmin, transports: new Map(), producers: new Map(), consumers: new Map() };
    peers.set(socket.id, peer);
    socket.join(isAdmin ? 'admin' : 'viewers');
    broadcastViewers();
    socket.emit('streamState', { live: isLive() });

    const on = (event: string, fn: (data: any) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void) => {
      socket.on(event, async (data: any, ack?: Ack) => {
        // socket.io passes the ack as the first argument when no payload is sent
        if (typeof data === 'function') {
          ack = data;
          data = {};
        }
        try {
          const res = (await fn(data ?? {})) ?? {};
          ack?.({ ok: true, ...res });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!(err instanceof ClientError)) console.error(`[signaling] ${event}:`, err);
          ack?.({ ok: false, error: err instanceof ClientError ? message : 'Internal error' });
        }
      });
    };

    const needAdmin = () => {
      if (!isAdmin) throw new ClientError('Not authorized');
    };
    const transportOf = (id: string) => {
      const t = peer.transports.get(id);
      if (!t) throw new ClientError('Unknown transport');
      return t;
    };

    on('rtpCapabilities', () => ({ rtpCapabilities: sfu.router.rtpCapabilities }));

    on('createTransport', async ({ direction }: { direction: 'send' | 'recv' }) => {
      if (direction === 'send') needAdmin();
      const transport = await sfu.router.createWebRtcTransport({
        webRtcServer: sfu.webRtcServer,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: config.rtc.initialOutgoingBitrate,
      });
      if (direction === 'send') await transport.setMaxIncomingBitrate(config.rtc.maxIncomingBitrate);
      peer.transports.set(transport.id, transport);
      transport.on('@close', () => peer.transports.delete(transport.id));
      return {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      };
    });

    on('connectTransport', async ({ transportId, dtlsParameters }) => {
      await transportOf(transportId).connect({ dtlsParameters });
    });

    on('produce', async ({ transportId, kind, rtpParameters, appData }) => {
      needAdmin();
      if (streamerId && streamerId !== socket.id) throw new ClientError('Another admin session is already streaming');
      const producer = await transportOf(transportId).produce({ kind, rtpParameters, appData: { ...appData } });
      streamerId = socket.id;
      peer.producers.set(producer.id, producer);
      allProducers.set(producer.id, producer);
      const gone = () => {
        peer.producers.delete(producer.id);
        if (!allProducers.delete(producer.id)) return;
        io.to('viewers').emit('producerClosed', { producerId: producer.id });
        if (peer.producers.size === 0 && streamerId === socket.id) streamerId = null;
        broadcastState();
      };
      producer.on('transportclose', gone);
      producer.on('@close', gone);
      io.to('viewers').emit('newProducer', { producerId: producer.id, kind: producer.kind });
      broadcastState();
      return { id: producer.id };
    });

    on('closeProducer', ({ producerId }) => {
      needAdmin();
      peer.producers.get(producerId)?.close();
    });

    on('getProducers', () => ({
      producers: [...allProducers.values()].map((p) => ({ id: p.id, kind: p.kind })),
    }));

    on('consume', async ({ transportId, producerId, rtpCapabilities }) => {
      if (!allProducers.has(producerId)) throw new ClientError('Producer not found');
      if (!sfu.router.canConsume({ producerId, rtpCapabilities })) {
        throw new ClientError('This browser cannot decode the stream codec');
      }
      const consumer = await transportOf(transportId).consume({ producerId, rtpCapabilities, paused: true });
      peer.consumers.set(consumer.id, consumer);
      consumer.on('producerclose', () => {
        if (peer.consumers.delete(consumer.id)) socket.emit('consumerClosed', { consumerId: consumer.id });
      });
      consumer.on('transportclose', () => peer.consumers.delete(consumer.id));
      return { id: consumer.id, producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters };
    });

    on('resumeConsumer', async ({ consumerId }) => {
      const consumer = peer.consumers.get(consumerId);
      if (!consumer) throw new ClientError('Unknown consumer');
      await consumer.resume();
    });

    socket.on('disconnect', () => {
      for (const t of [...peer.transports.values()]) t.close(); // also closes its producers/consumers
      peers.delete(socket.id);
      if (streamerId === socket.id) streamerId = null;
      broadcastViewers();
      broadcastState();
    });
  });
}
