# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A NestJS backend that serves a React (Vite) frontend and is also a task engine: it starts one Docker container per agentic-dev-base task (image `ENGINE_IMAGE`, command `agentic-bridge`), talks to each task's bridge over HTTP/WebSocket, and exposes a REST/SSE API under `/api`. The frontend is still only a system-info slice; the engine has no UI. README.md documents the REST API, all `ENGINE_*` variables and Docker usage in detail. Needs Node 22+.

## Commands

```sh
npm install
npm run build       # nest build -> dist/backend, vite build -> dist/frontend
npm start           # node dist/backend/main.js; needs ENGINE_* env (copy .env.example to .env)
npm run dev:frontend  # Vite dev server, proxies /api to :3000 (run `npm start` alongside)
npm run lint        # ESLint on backend/{src,test}
npm test            # unit tests: backend (backend/test/unit) + frontend (frontend/test, jsdom)
npm run test:e2e    # supertest with fake launcher + fake bridge; frontend tests need a prior build
npm run test:bridge # real agentic-bridge process + fake agent; skipped if agentic-bridge not on PATH
npm run test:docker # real Docker; needs ENGINE_IMAGE and FAKE_AGENT_DIR, else skipped
npm run test:ui     # Playwright (e2e/), builds and starts the app on port 3100
```

Single test: `npx jest --selectProjects backend -t "name"` or `npx jest path/to/file.spec.ts`. For other suites pass their config, e.g. `npx jest --config backend/test/e2e/jest-e2e.config.js tasks.e2e-spec`. Suffixes differ per suite: `.spec.ts` (unit), `.e2e-spec.ts`, `.bridge-spec.ts`, `.docker-spec.ts`.

## Architecture

Strict layering, enforced by convention:
- Backend: `api` → `service` → `integration` / `repository` → `commons`, one Nest module per layer per area (`<Area>ApiModule` etc.), each importing only the layer below. `integration` = external systems and runtimes (task launchers, bridge client); `repository` = storage only. The service owns the interfaces and injection tokens it needs (`TaskLauncher`/`TASK_LAUNCHER`, `BridgeClient`/`BRIDGE_CLIENT_FACTORY`) and imports no integration class; only `<Area>ServiceModule` imports the integration module to wire the implementations. Controllers contain HTTP concerns only. Routes are `/api/<area>/...`. Validation, logging and error mapping are global pipes/interceptors/filters from `commons/`, registered in `backend/src/app.setup.ts`, not per method.
- Frontend: `views` → `state` → `api`; only `frontend/src/api` calls the backend.
- Tests mirror the source tree under `backend/test/unit` and `frontend/test`.

Task engine (`backend/src/service/tasks`, `backend/src/integration/tasks`, `backend/src/repository/tasks`):
- `TaskLauncher` (interface in `service/tasks/task-launcher.ts`) runs containers; `DockerTaskLauncher` is the only implementation, in `integration/tasks/launcher/`, selected by name in `task-launcher.factory.ts` via `ENGINE_LAUNCHER`. The launcher only returns a bridge base URL; the bridge client (`HttpBridgeClient` in `integration/tasks/bridge/`, interface in `service/tasks/bridge-client.ts`) is independent of it and uses the task token.
- Task records are one mode-600 JSON file per task in `ENGINE_DATA_DIR` (`task-record.repository.ts`). They contain tokens, which must never appear in API responses or container labels.
- The task container clones the repo itself (start step `05-workspace`) before the bridge starts; with `AGENTIC_WORKTREE=1` the bridge exits if `/work` isn't a git checkout with a commit. Git push credentials are injected via `GIT_CONFIG_*` env referencing `GH_TOKEN` (`git-credential-env.ts`), never a token value or file.
- `ENGINE_MAX_RUNNING` caps running containers (409 beyond it). Prompt/answer wake a non-running container, except a task that was stopped via `/stop` (final; 409 immediately).
- Bridge events are relayed to clients as SSE (`task-events.service.ts`). Bridge errors map to HTTP via `bridge-error.filter.ts` (400/404/409/503 pass through, anything else is 502).
- `engine-config.ts` validates env at startup and names the bad variable without printing values.

Test helpers (`backend/test/helpers`; the fake agent is `tools/fake-agent/fake-agent.mjs`) provide a fake bridge, fake launcher, local-process launcher and fake agent used by the e2e/bridge/docker suites.

## Notes

- `ENGINE_IMAGE` is the project's agentic image (`agentic build`), not the image built from `Dockerfile` (which is the UI itself).
- The engine has no authentication, and the compose setup mounts the Docker socket; don't expose it beyond a trusted network.
- `.worktrees/` is git-ignored (agentic task worktrees).
