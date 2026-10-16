# Image of the UI/engine itself (NestJS backend + built React frontend).
#
# NOT the task image: task containers run ENGINE_IMAGE (for example agentic-pathfinder-dev-ui:local),
# the project's agentic-dev-base image that you build with `agentic build`. This file builds only
# the UI that starts those task containers through the Docker socket.

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
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Task records live here (ENGINE_DATA_DIR=/data in compose); a named volume copies this ownership.
RUN mkdir /data && chown node:node /data
# Non-root. To use the Docker socket the container needs the socket's group: compose.yaml adds the
# numeric DOCKER_GID with group_add.
USER node
EXPOSE 3000
CMD ["node", "dist/backend/main.js"]
