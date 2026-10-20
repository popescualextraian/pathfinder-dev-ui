# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A NestJS backend that serves a React (Vite) frontend and is also a task engine: it starts one Docker container per agentic-dev-base task (image `ENGINE_IMAGE`, command `agentic-bridge`), talks to each task's bridge over HTTP/WebSocket, and exposes a REST/SSE API under `/api`. The frontend is a task UI (task list, task view, full run) plus a system-info footer. README.md documents the REST API, all `ENGINE_*` variables and Docker usage in detail. Needs Node 22+.

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
npm run start:local # build + run the app with the local launcher, no Docker (see "Test your version")
npm run test:docker # real Docker; needs ENGINE_IMAGE and FAKE_AGENT_DIR, else skipped
npm run test:ui     # Playwright (e2e/), builds and starts the app on port 3100
```

Single test: `npx jest --selectProjects backend -t "name"` or `npx jest path/to/file.spec.ts`. For other suites pass their config, e.g. `npx jest --config backend/test/e2e/jest-e2e.config.js tasks.e2e-spec`. Suffixes differ per suite: `.spec.ts` (unit), `.e2e-spec.ts`, `.bridge-spec.ts`, `.docker-spec.ts`.

## Test your version

Run your checkout's app next to others without Docker (`local` launcher, real `agentic-bridge`, fake agent; no isolation, development only; the fake agent's `SHELL:` runs commands as the app's user, so `start:local` drops `CLAUDE_CODE_OAUTH_TOKEN` (and `GH_TOKEN` for a local-path repo) from the app env; bridges listen on 0.0.0.0, only their tokens protect them):

```sh
PORT=3101 npm run start:local > /tmp/app-3101.log 2>&1 &   # pick a free port; builds first, wait for "successfully started" in the log
kill $(cat .local/3101.pid)                                 # stop it; also stops its bridges (Ctrl-C if in the foreground)
```

Data lives in `.local/<port>/` (wiped at each start, git-ignored). Drive it with curl (routes in README, e.g. `curl -H 'content-type: application/json' -d '{"prompt":"hi"}' localhost:3101/api/tasks`, then `GET /api/tasks/<id>`, `/events`) or the Playwright MCP against `http://localhost:3101`. The fake agent (`tools/fake-agent/fake-agent.mjs`) answers `echo: <prompt>`; `ASK:<text>` raises a question (answer via `/answer`), `SLEEP:<ms>` runs a long turn (cancel via `/cancel`), `CRASH` exits the agent. Use the real Claude (`ENGINE_LOCAL_AGENT=claude`, needs `CLAUDE_CODE_OAUTH_TOKEN`) only when asked: it costs real tokens. Stop and delete tasks you created, and stop the app when done.

## Architecture

Strict layering, enforced by convention:
- Backend: `api` → `service` → `integration` / `repository` → `commons`, one Nest module per layer per area (`<Area>ApiModule` etc.), each importing only the layer below. `integration` = external systems and runtimes (task launchers, bridge client); `repository` = storage only. The service owns the interfaces and injection tokens it needs (`TaskLauncher`/`TASK_LAUNCHER`, `BridgeClient`/`BRIDGE_CLIENT_FACTORY`) and imports no integration class; only `<Area>ServiceModule` imports the integration module to wire the implementations. Controllers contain HTTP concerns only. Routes are `/api/<area>/...`. Validation, logging and error mapping are global pipes/interceptors/filters from `commons/`, registered in `backend/src/app.setup.ts`, not per method.
- Frontend: `views` → `state` → `api`; only `frontend/src/api` calls the backend.
- Tests mirror the source tree under `backend/test/unit` and `frontend/test`.

Task engine (`backend/src/engine`, its own package: `service/`, `integration/`, `repository/` inside). It imports nothing from the backend but `commons/`, and the rest of the backend (`api/tasks`) imports it only via `engine/index.ts`; `backend/test/unit/engine/engine-boundary.spec.ts` enforces both. Keep it that way: it may become a separate project.

Backlog (`backend/src/backlog`, its own package like the engine; optional: on only when `BACKLOG_CONFIG` names the lanes YAML, with `BACKLOG_DATA_DIR` and the token variable named by `gitlab.tokenEnv`). It imports nothing from the backend but `commons/`, and `api/backlog` imports it only via `backlog/index.ts`; `backend/test/unit/backlog/backlog-boundary.spec.ts` enforces both. A `BacklogConnector` interface (service) is implemented by the GitLab connector (integration); GitLab is the source of truth, the cache is one mode-600 JSON file, a move writes through with `{from,to}` (409 if the source disagrees), trigger events are emitted only for board moves and nobody listens yet. The token must never appear in logs, responses or files. Frontend: board at `#/backlog`. `npm run start:local` passes `BACKLOG_*` and the token through (the fake agent's `SHELL:` could read it: throwaway token only).
- `TaskLauncher` (interface in `engine/service/task-launcher.ts`) runs containers; `DockerTaskLauncher` and `LocalTaskLauncher` (bridge as child process, no isolation) are the implementations, in `engine/integration/launcher/`, selected by name in `task-launcher.factory.ts` via `ENGINE_LAUNCHER`. The launcher only returns a bridge base URL; the bridge client (`HttpBridgeClient` in `engine/integration/bridge/`, interface in `engine/service/bridge-client.ts`) is independent of it and uses the task token.
- Task records are one mode-600 JSON file per task in `ENGINE_DATA_DIR` (`task-record.repository.ts`). They contain tokens, which must never appear in API responses or container labels.
- The task container clones the repo itself (start step `05-workspace`) before the bridge starts; with `AGENTIC_WORKTREE=1` the bridge exits if `/work` isn't a git checkout with a commit. Git push credentials are injected via `GIT_CONFIG_*` env referencing `GH_TOKEN` (`git-credential-env.ts`), never a token value or file.
- `ENGINE_MAX_RUNNING` caps running containers (409 beyond it). Prompt/answer wake a non-running container, except a task that was stopped via `/stop` (final; 409 immediately).
- Bridge events are relayed to clients as SSE (`task-events.service.ts`). Bridge errors map to HTTP via `bridge-error.filter.ts` (400/404/409/503 pass through, anything else is 502).
- `engine-config.ts` validates env at startup and names the bad variable without printing values.

Test helpers (`backend/test/helpers`; the fake agent is `tools/fake-agent/fake-agent.mjs`) provide a fake bridge, fake launcher, local-process launcher and fake agent used by the e2e/bridge/docker suites.

## Frontend

`frontend/src`, strict layering `views` → `state` → `api`:
- `api/`: the only code that calls the backend. `http.ts` (fetch, `ApiError`), `models.ts` (all typed models), `tasks-api.ts`, `repositories-api.ts`, `system-api.ts`, `task-status-stream.ts` (SSE `/api/tasks/stream`), `task-events-stream.ts` (SSE of one task's full run; reconnects from the last seq).
- `state/` (hooks): `useRoute`, `useRepositories`, `useTasks(filter)` (list once, then status stream; reloads on reconnect), `useTask(id, live)`, `useTaskRun(id)` (stream opened only while `FullRun` is mounted; merges message chunks), `use-task-actions` (start, prompt, answer, cancel, close, delete with pending/error), `useSystemInfo`.
- `views/` (components, no API calls, one CSS module each): AppShell, Sidebar, RepositoryList, TaskList, TaskSection, TaskCard, TaskView, PromptBlock, LastResponse, QuestionCard, FullRun, ReplyBox, FactsPanel, NewTaskDialog, StatePill, Button, SystemInfoView (footer). `App.tsx` wires them.
- Styling: design tokens are CSS variables in `theme.css` (`--msg-red`, `--ink`, `--paper`, `--line`, state colors); components use only these in their `*.module.css`. No external fonts or CDNs.
- URL hash state: `#/repo/<name>/task/<id>` (either part optional) holds the repository filter and selected task, so reload and links keep them.
- Tests (`frontend/test`, jest + Testing Library, jsdom): CSS is mapped to `frontend/test/style-stub.js` (CSS modules return no class names). The API is tested with `fetch` and `EventSource` mocked (`test/api/fake-event-source.ts`, `test/fixtures/tasks.ts`); views mock `api/*` modules.
- See the screens: `npm run dev:frontend` (Vite proxies `/api` to :3000, run `npm start` alongside), or `npm run start:local` (see "Test your version") and open the port.

## Notes

- `ENGINE_IMAGE` is the project's agentic image (`agentic build`), not the image built from `Dockerfile` (which is the UI itself).
- The engine has no authentication, and the compose setup mounts the Docker socket; don't expose it beyond a trusted network.
- `.worktrees/` is git-ignored (agentic task worktrees).
