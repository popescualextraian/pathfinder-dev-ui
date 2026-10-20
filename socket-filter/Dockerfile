# The Docker socket filter: the only container that mounts the raw /var/run/docker.sock.
# No runtime dependencies; TypeScript is only needed to build.
FROM node:22-slim AS build
WORKDIR /app
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
