# The Docker socket filter: the only container that mounts the raw /var/run/docker.sock.
# No runtime dependencies; TypeScript is only needed to build.
# Optional build context with proxy root certificates (*.crt), see ../Dockerfile; empty by default.
FROM scratch AS ca

FROM node:22-slim AS build
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
WORKDIR /app
# Proxy root certificates (a TLS-intercepting proxy such as Zscaler), optional: an empty folder (or none) changes nothing.
# They come only from the build context `ca` (compose: PATHFINDER_CA_CONTEXT), never from this repository. Node reads the system bundle for npm ci.
RUN --mount=type=bind,from=ca,target=/tmp/ca \
    mkdir -p /usr/local/share/ca-certificates/pathfinder && cp /tmp/ca/*.crt /usr/local/share/ca-certificates/pathfinder/ 2>/dev/null || true; \
    if command -v update-ca-certificates >/dev/null; then update-ca-certificates; fi
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
ENV FILTER_LISTEN=/run/docker-filter/docker.sock
WORKDIR /app
COPY --from=build /app/dist ./dist
# The filter socket lives here (a named volume shared with the UI copies this ownership).
RUN mkdir -p /run/docker-filter && chown node:node /run/docker-filter
# Non-root; compose adds the Docker socket's group (DOCKER_GID) with group_add.
USER node
CMD ["node", "dist/main.js"]
