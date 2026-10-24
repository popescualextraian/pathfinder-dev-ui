# Image of the UI/engine itself (NestJS backend + built React frontend).
#
# NOT the task image: task containers run ENGINE_IMAGE (for example agentic-pathfinder-dev-ui:local),
# the project's agentic-dev-base image that you build with `agentic build`. This file builds only
# the UI that starts those task containers through the filtered Docker socket (docker-filter in compose.yaml).

# Optional build context with proxy root certificates (*.crt); empty unless the build passes --build-context ca=<folder>.
FROM scratch AS ca

FROM node:22-slim AS build
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
WORKDIR /app
# Proxy root certificates (a TLS-intercepting proxy such as Zscaler), optional: an empty folder (or none) changes nothing.
# They come only from the build context `ca` (compose: PATHFINDER_CA_CONTEXT, tools/deploy.sh: ~/.agentic/ca or
# PATHFINDER_CA_DIR), never from this repository. Node reads the system bundle for npm ci and for its own https calls.
RUN --mount=type=bind,from=ca,target=/tmp/ca \
    mkdir -p /usr/local/share/ca-certificates/pathfinder && cp /tmp/ca/*.crt /usr/local/share/ca-certificates/pathfinder/ 2>/dev/null || true; \
    if command -v update-ca-certificates >/dev/null; then update-ca-certificates; fi
COPY package.json package-lock.json ./
RUN npm ci
COPY nest-cli.json ./
COPY backend ./backend
COPY frontend ./frontend
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
# The UI's own https calls (GitLab) trust the system store, which the step below extends with the proxy roots.
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
WORKDIR /app
# git reads the repositories of the architecture page (bare partial clones under ARCHITECTURE_DATA_DIR); CA certificates for https remotes.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
# Proxy root certificates (a TLS-intercepting proxy such as Zscaler), optional: an empty folder (or none) changes nothing.
# They come only from the build context `ca` (compose: PATHFINDER_CA_CONTEXT, tools/deploy.sh: ~/.agentic/ca or
# PATHFINDER_CA_DIR), never from this repository. Node reads the system bundle for npm ci and for its own https calls.
RUN --mount=type=bind,from=ca,target=/tmp/ca \
    mkdir -p /usr/local/share/ca-certificates/pathfinder && cp /tmp/ca/*.crt /usr/local/share/ca-certificates/pathfinder/ 2>/dev/null || true; \
    if command -v update-ca-certificates >/dev/null; then update-ca-certificates; fi
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Task records live here (ENGINE_DATA_DIR=/data in compose); a named volume copies this ownership.
RUN mkdir /data && chown node:node /data
# Non-root (uid 1000). The UI reaches Docker only through the socket filter's socket (DOCKER_HOST in compose.yaml),
# which is owned by this user; it needs no Docker group and does not mount the raw Docker socket.
USER node
EXPOSE 3000
CMD ["node", "dist/backend/main.js"]
