# syntax=docker/dockerfile:1

# ---- 1. Build the Angular client ----
FROM node:22-bookworm-slim AS client
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY client/ ./
RUN npx ng build

# ---- 2. Build the server and keep only production dependencies ----
# (Debian, not Alpine: mediasoup ships a prebuilt glibc worker binary.)
FROM node:22-bookworm-slim AS server
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
# The install is split in two on purpose. mediasoup's own install script downloads its worker binary from
# GitHub with no timeout, so on a slow or stalled connection `npm ci` hangs forever (and, never finishing,
# is never cached). Here the packages install first, then the download runs alone with a hard timeout
# and retries, and is cached as its own layer.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
RUN cd node_modules/mediasoup  && for i in 1 2 3 4 5; do timeout 120 node npm-scripts.mjs postinstall && break; echo "mediasoup worker download failed (attempt $i), retrying"; sleep 5; done  && test -x worker/out/Release/mediasoup-worker
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---- 3. Runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    RTC_PORT=40000 \
    DATA_DIR=/data
WORKDIR /app/server
# Layout matches the default CLIENT_DIR resolution (../../client/dist/client/browser).
COPY --from=server /build/server/package.json ./
COPY --from=server /build/server/node_modules ./node_modules
COPY --from=server /build/server/dist ./dist
COPY --from=client /build/client/dist/client/browser /app/client/dist/client/browser
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000 40000/tcp 40000/udp
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.js"]
