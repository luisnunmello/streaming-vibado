# syntax=docker/dockerfile:1

# ---- 1. Build the Angular client ----
FROM node:22-bookworm-slim AS client
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npx ng build

# ---- 2. Build the server and keep only production dependencies ----
# (Debian, not Alpine: mediasoup ships a prebuilt glibc worker binary.)
FROM node:22-bookworm-slim AS server
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
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
