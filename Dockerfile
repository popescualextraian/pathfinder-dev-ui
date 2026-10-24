# Image of the UI/engine itself (NestJS backend + built React frontend).
#
# NOT the task image: task containers run ENGINE_IMAGE (for example agentic-pathfinder-dev-ui:local),
# the project's agentic-dev-base image that you build with `agentic build`. This file builds only
# the UI that starts those task containers through the filtered Docker socket (docker-filter in compose.yaml).

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY nest-cli.json ./
COPY backend ./backend
COPY frontend ./frontend
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
# git reads the repositories of the architecture page (bare partial clones under ARCHITECTURE_DATA_DIR); CA certificates for https remotes.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
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
