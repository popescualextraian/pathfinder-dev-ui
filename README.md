# agentic-dev-base UI

A NestJS (TypeScript) backend that serves a React frontend, and the task engine behind it. The
frontend so far shows one slice of the layers: `GET /api/system/info` returns
`{ name, version, uptimeSeconds }`. The engine is a REST API (below) with no UI yet.

## Engine overview

The engine starts and drives agentic-dev-base tasks. A task is one container running the project's
agentic image with `agentic-bridge` as its command.

- `POST /api/tasks` creates a container (and volume) per task through a `TaskLauncher` (Docker now),
  with the task's prompt, two random per-task tokens (task token, agent token), and your secrets
  (`CLAUDE_CODE_OAUTH_TOKEN`, `GH_TOKEN`) in its environment.
- The container clones the repository itself when it starts (start step `05-workspace`, git
  credentials from `GH_TOKEN`, never written to a file) and works on its own branch
  `agentic/<task-id>` in a git worktree (`AGENTIC_WORKTREE=1`). The task gets the `push` grant; the
  branch stays on GitHub after the task is removed.
- The engine talks to each task's bridge (HTTP API v1, `Authorization: Bearer <task token>`) at
  `http://<container-name>:8765`. The UI and the task containers share one Docker network
  (`ENGINE_DOCKER_NETWORK`); the engine sets `AGENTIC_BRIDGE_HOSTS=<container-name>` so the bridge
  accepts that Host header. Live bridge events (WebSocket) are passed on as Server-Sent Events.
- Task records are one JSON file per task (mode 600) under `ENGINE_DATA_DIR`. They hold the tokens,
  which never leave the backend: no API response or container label contains one.
- At most `ENGINE_MAX_RUNNING` task containers run at once; a start (or waking a suspended task)
  beyond that is refused with 409. Prompting or answering a task whose container is not running
  (suspended, or stopped outside the engine with `docker stop`) starts it first and waits for its
  bridge. A task stopped with `POST /stop` (or whose bridge reports `stopped`) is final: prompt and
  answer are refused with 409 ("task is stopped") at once, without starting its container.
- Task container: image `ENGINE_IMAGE`, name and volume `agentic-ui-task-<id>` (volume mounted at
  `/task`), labels `agentic-ui.task=<id>` and `agentic-ui.kind=task`, all capabilities dropped,
  `no-new-privileges`. Removing a task deletes container, volume and record.

The task needs its repository cloned **before the bridge starts**: with `AGENTIC_WORKTREE=1` the
bridge creates the worktree at boot and exits ("could not create the worktree") if `/work` is not a
git checkout with at least one commit. In the Docker launcher the `05-workspace` start step does the
clone from `AGENTIC_REPO_URL`.

The engine has no authentication of its own: whoever can reach port 3000 can start tasks that use
your tokens. Do not expose it beyond a trusted network.

## Configuration

The engine reads environment variables (`backend/src/commons/engine-config.ts`); copy
`.env.example` to `.env` (git-ignored) and fill it in. The app refuses to start when a required value
is missing or invalid, naming the variable, never printing a value.

| Variable | Required | Meaning |
|---|---|---|
| `ENGINE_LAUNCHER` | no, default `docker` | Which launcher runs tasks; only `docker` exists. An unknown value is refused when the launcher is created. |
| `ENGINE_IMAGE` | yes | Task image that runs `agentic-bridge`: the project's agentic image built with `agentic build`, for example `agentic-pathfinder-dev-ui:local`. Not the image of `Dockerfile`. |
| `ENGINE_DOCKER_NETWORK` | yes | Docker network shared by the UI and the task containers (`agentic-ui` in `compose.yaml`). |
| `ENGINE_DATA_DIR` | yes | Absolute directory for task records (`/data` in `compose.yaml`). |
| `ENGINE_REPO_URL` | yes | Repository tasks clone when the request gives no `repoUrl`. Must not contain credentials. |
| `ENGINE_ALLOWED_REPO_HOSTS` | no | Comma-separated hosts a request's `repoUrl` may use, in addition to the host of `ENGINE_REPO_URL` (which is always allowed). The host of a repository gets `GH_TOKEN` for the clone, so other hosts are refused with 400. |
| `ENGINE_PROJECT` | yes | Project name passed to tasks (`AGENTIC_PROJECT`). |
| `ENGINE_MAX_RUNNING` | no, default `2` | Maximum running task containers (positive integer). |
| `CLAUDE_CODE_OAUTH_TOKEN` | yes, secret | Passed into task containers. |
| `GH_TOKEN` | yes, secret | Passed into task containers; used for the clone and for push. |
| `ENGINE_TASK_EXTRA_ENV` | no, test hook | JSON object of strings added to each task container's environment (keys must be valid variable names; keys the engine sets itself, such as the tokens, `GH_TOKEN`, `AGENTIC_TASK_ID`, `AGENTIC_BRANCH` or `AGENTIC_BRIDGE_HOSTS`, are refused at start-up). |
| `ENGINE_TASK_EXTRA_BINDS` | no, test hook | JSON array of `host:container[:mode]` binds added to each task container. |

`PORT` (default 3000) sets the HTTP port. Docker itself is reached through the usual socket or
`DOCKER_HOST` (dockerode).

## REST API

All under `/api`. A task view contains the task's fields without tokens: `id`, `prompt`, `repoUrl`,
`repoRef?`, `model?`, `branch`, `createdAt`, `updatedAt`, `state`, `reason?`, `questions`, `summary?`.

| Route | Does | Success |
|---|---|---|
| `POST /api/tasks` `{prompt, repoUrl?, repoRef?, model?}` | Starts a task and waits for its bridge. `repoUrl` must be https without credentials, on an allowed host (see `ENGINE_ALLOWED_REPO_HOSTS`), and defaults to `ENGINE_REPO_URL`. | 201 task |
| `GET /api/tasks` | All tasks, with the last known state | 200 |
| `GET /api/tasks/:id` | Task with live bridge status (state, reason, open questions, summary, branch) | 200 |
| `POST /api/tasks/:id/prompt` `{text}` | Sends a prompt; wakes a container that is not running first; 409 for a stopped task | 202 task |
| `POST /api/tasks/:id/answer` `{text, question?}` | Answers a question; default is the oldest open one; wakes like prompt; 409 for a stopped task | 202 task |
| `POST /api/tasks/:id/cancel` | Cancels the running turn | 202 task |
| `POST /api/tasks/:id/stop` | Bridge `/stop`, then stops the container | 202 task |
| `DELETE /api/tasks/:id` | Removes container, volume and record; 409 unless the task is stopped | 204 |
| `GET /api/tasks/:id/events?since=N` | Events after sequence number N as a JSON array; 409 when the container is not running | 200 |
| `GET /api/tasks/:id/events/stream?since=N` | The same events, then live ones, as SSE (`id` is the event `seq`; `Last-Event-ID`, which EventSource sends on reconnect, takes precedence over `since` when present) | 200 |
| `GET /api/system/info` | `{ name, version, uptimeSeconds }` | 200 |

Errors: bridge 400, 404, 409 and 503 pass through with the bridge's message; any other bridge answer
(including 401/403) and an unreachable bridge give 502 with a fixed message. An unknown task is 404;
starting beyond `ENGINE_MAX_RUNNING` is 409. Limits: `prompt`/`text` at most 20000 characters and not
blank. Errors inside an SSE stream that already started arrive as an SSE `error` event.

## Install

```sh
npm install
```

Needs Node 22+.

## Build and run

```sh
npm run build   # backend -> dist/, frontend (Vite) -> dist/frontend
npm start       # http://localhost:3000 (set PORT to change); needs the ENGINE_* variables, see Configuration
```

The frontend is served at `/`, the API under `/api`. For frontend development,
run `npm start` and, in a second terminal, `npm run dev:frontend` (Vite proxies `/api` to port 3000).

## Run in Docker

Two different images are involved:

- The **task image** (`ENGINE_IMAGE`) is the project's agentic-dev-base image, built with
  `agentic build` (for example tagged `agentic-pathfinder-dev-ui:local`). Task containers run it.
- The **UI image** is built from `Dockerfile` (Node 22, `npm ci`, `npm run build`, runs
  `node dist/backend/main.js` as user `node`, port 3000). It only contains this engine.

```sh
agentic build                       # the task image; note its tag for ENGINE_IMAGE
cp .env.example .env                # fill in secrets, ENGINE_IMAGE, ENGINE_REPO_URL, ENGINE_PROJECT
DOCKER_GID=$(stat -c %g /var/run/docker.sock) docker compose up --build
```

`compose.yaml` runs service `ui` (published on `127.0.0.1:${UI_PORT:-3000}` only) with `.env`, the Docker socket, a named volume `engine-data` at
`/data` (task records), `group_add` of the numeric `DOCKER_GID` (so the non-root user may use the
socket; compose refuses to start without it), and a network with the fixed name `agentic-ui`. It sets
`ENGINE_DOCKER_NETWORK=agentic-ui` and `ENGINE_DATA_DIR=/data`, which win over `.env`; `ENGINE_IMAGE`
defaults to `agentic-pathfinder-dev-ui:local`. Task containers started by the UI join `agentic-ui`, so
the UI reaches each bridge by container name. Host paths in `ENGINE_TASK_EXTRA_BINDS` refer to the
Docker host, not to the UI container.

Warning: access to the Docker socket is root on the host. Whoever controls this container, or can
call its API, can control the host. Run it only where that is acceptable.

The Docker parts (`Dockerfile`, `compose.yaml`, `npm run test:docker`) were written without a Docker
daemon available and have not been run yet; `docker compose config` accepts the compose file.

## Test

| Command | What |
|---|---|
| `npm test` | Jest unit tests: backend (`backend/test/unit/`) and frontend (`frontend/test/`, jsdom + React Testing Library) |
| `npm run test:e2e` | Backend e2e tests (`backend/test/e2e/`, Jest + supertest; REST API with a fake launcher and a fake bridge). Needs a prior `npm run build` for the frontend tests. |
| `npm run test:bridge` | `backend/test/bridge/`: the real `agentic-bridge` as a local process with a fake agent (`backend/test/fixtures/fake-agent.mjs`), driven through the bridge client and the task service. Skipped with a message on stderr where `agentic-bridge` is not on PATH. |
| `npm run test:docker` | `backend/test/docker/`: real Docker, real task image, fake agent: start a task, reach idle, prompt and see the echo, stop, remove, check container and volume are gone. Linux host only (the test reaches the bridge at the container's IP on its network). Needs `FAKE_AGENT_DIR` (directory holding agentic-dev-base's `bridge/test/fake-agent.mjs`, mounted at `/fake`), `ENGINE_IMAGE` and a reachable Docker daemon; otherwise skipped with a message on stderr. It creates a temporary network and a local git repository (bound into the task and cloned from there, no GitHub needed) and cleans up after itself. Example: `FAKE_AGENT_DIR=/path/to/agentic-dev-base/bridge/test ENGINE_IMAGE=agentic-pathfinder-dev-ui:local npm run test:docker` |
| `npm run test:ui` | Playwright (`e2e/`). Builds and starts the app on port 3100, uses the Chromium under `PLAYWRIGHT_BROWSERS_PATH` if set. |
| `npm run lint` | ESLint for `backend/src/` and `backend/test/` |

## Launchers

A launcher runs task containers somewhere. The interface is `TaskLauncher` in
`backend/src/repository/tasks/launcher/task-launcher.ts`:

```ts
launch(spec: LaunchSpec): Promise<LaunchResult>   // create and start; returns the bridge base URL
start(taskId: string): Promise<void>              // start an existing, stopped container
stop(taskId: string): Promise<void>
remove(taskId: string): Promise<void>             // container and volume; no-op when gone
inspect(taskId: string): Promise<TaskInspection>  // { exists, running, bridgeUrl }
countRunning(): Promise<number>                   // for the ENGINE_MAX_RUNNING cap
```

The bridge client does not depend on the launcher: the launcher only returns the bridge base URL, and
the service talks to that URL with the task token. To add another launcher (for example Azure):

1. Implement `TaskLauncher` in `backend/src/repository/tasks/launcher/` (it gets the `EngineConfig`).
2. Register it in `backend/src/repository/tasks/launcher/task-launcher.factory.ts` under a new name.
3. Use that name as `ENGINE_LAUNCHER`.
4. Add unit tests next to `docker-task-launcher.spec.ts`; the bridge URL it returns must be reachable
   from the engine, and the container needs the same environment contract as the Docker one
   (`AGENTIC_TASK_TOKEN`, `AGENTIC_AGENT_TOKEN`, `AGENTIC_BRIDGE_HOSTS`, ... see `DockerTaskLauncher`).

## Layout

```
backend/
  src/
    main.ts, app.setup.ts   bootstrap; global prefix /api, pipe, interceptor, filters
    app.module.ts           imports the api modules and serves dist/frontend
    api/<area>/             controllers (HTTP only, no business logic): system/, tasks/ (+ dto/)
    service/<area>/         business logic: system/, tasks/ (tasks.service.ts, task-events.service.ts)
    repository/<area>/      data access: system/ (package.json), tasks/
      tasks/                task-record.repository.ts (JSON files), bridge/ (bridge client),
                            launcher/ (TaskLauncher, Docker launcher, factory)
    commons/                engine config, validation pipe, logging interceptor, exception filters, shared utilities
  test/
    unit/                   unit tests, mirroring src/
    e2e/                    Nest + supertest tests and their Jest config
    bridge/                 real-bridge suite (npm run test:bridge)
    docker/                 real-Docker suite (npm run test:docker)
    fixtures/, helpers/     fake agent, fake bridge, fake and local-process launchers
frontend/
  src/
    api/                    the only code that calls the backend
    state/                  hooks holding the data
    views/                  components; they use state, never api/
  test/                     unit tests, mirroring src/
e2e/                        Playwright tests (whole app)
package.json                one, at the root
Dockerfile, compose.yaml    the UI image and its compose setup (see Run in Docker)
.env.example                engine configuration template
```

Build output: `dist/backend` (Nest) and `dist/frontend` (Vite).

## Layer rules

- Backend dependencies go only downwards: `api` → `service` → `repository` → `commons`.
- Each area has one Nest module per layer (`<Area>ApiModule`, `<Area>ServiceModule`,
  `<Area>RepositoryModule`); a layer's module imports only the module of the layer below.
- Routes are prefixed with the area: `/api/<area>/...`.
- Cross-cutting concerns (validation, logging, errors) live in pipes, interceptors and filters
  in `commons/`, registered globally in `app.setup.ts`, not in each method.
- Frontend: `views` → `state` → `api`.
