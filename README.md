# agentic-dev-base UI

A NestJS (TypeScript) backend that serves a React frontend, and the task engine behind it. The
frontend so far shows one slice of the layers: `GET /api/system/info` returns
`{ name, version, uptimeSeconds }`. The engine is a REST API (below) with no UI yet.

## Engine overview

The engine starts and drives agentic-dev-base tasks. A task is one container running the project's
agentic image with `agentic-bridge` as its command.

- `POST /api/tasks` creates a container (and volume) per task through a `TaskLauncher` (Docker, or the `local` process launcher for development),
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
| `ENGINE_LAUNCHER` | no, default `docker` | Which launcher runs tasks: `docker` or `local` (see Local launcher). An unknown value is refused when the launcher is created. |
| `ENGINE_LOCAL_AGENT` | no, default `fake`; `local` only | `fake` (scripted fake agent) or `claude` (the bridge's default agent, Claude Code). Anything else is refused at start-up. |
| `ENGINE_IMAGE` | `docker` only | Task image that runs `agentic-bridge`: the project's agentic image built with `agentic build`, for example `agentic-pathfinder-dev-ui:local`. Not the image of `Dockerfile`. |
| `ENGINE_DOCKER_NETWORK` | `docker` only | Docker network shared by the UI and the task containers (`agentic-ui` in `compose.yaml`). |
| `ENGINE_DATA_DIR` | yes | Absolute directory for task records (`/data` in `compose.yaml`). |
| `ENGINE_REPO_URL` | yes | Repository tasks clone when the request gives no `repoUrl`. Must not contain credentials. |
| `ENGINE_ALLOWED_REPO_HOSTS` | no | Comma-separated hosts a request's `repoUrl` may use, in addition to the host of `ENGINE_REPO_URL` (which is always allowed). The host of a repository gets `GH_TOKEN` for the clone, so other hosts are refused with 400. |
| `ENGINE_PROJECT` | yes | Project name passed to tasks (`AGENTIC_PROJECT`). |
| `ENGINE_GIT_NAME` | `docker`; `local` only when `GH_TOKEN` is set | Commit author and committer name of task containers (`GIT_AUTHOR_NAME`, `GIT_COMMITTER_NAME`). |
| `ENGINE_GIT_EMAIL` | `docker`; `local` only when `GH_TOKEN` is set | Commit author and committer email (`GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_EMAIL`). |
| `ENGINE_MAX_RUNNING` | no, default `2` | Maximum running task containers (positive integer). |
| `CLAUDE_CODE_OAUTH_TOKEN` | `docker`; `local` only with `ENGINE_LOCAL_AGENT=claude`; secret | Passed into task containers. |
| `GH_TOKEN` | `docker`; optional for `local` (needed only to push); secret | Passed into task containers; used for the clone and for push. |
| `ENGINE_TASK_EXTRA_ENV` | no, test hook | JSON object of strings added to each task container's environment (keys must be valid variable names; keys the engine sets itself, such as the tokens, `GH_TOKEN`, `AGENTIC_TASK_ID`, `AGENTIC_BRANCH`, `AGENTIC_BRIDGE_HOSTS`, the four `GIT_AUTHOR_*`/`GIT_COMMITTER_*` identity variables, `GIT_CONFIG_COUNT` and `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>`, are refused at start-up). |
| `ENGINE_TASK_EXTRA_BINDS` | no, test hook | JSON array of `host:container[:mode]` binds added to each task container. |

`ENGINE_DATA_DIR`, `ENGINE_REPO_URL` and `ENGINE_PROJECT` are required for every launcher. `PORT` (default 3000) sets the HTTP port; the app listens on all interfaces. Docker itself is reached through the usual socket or
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

## Local launcher (no Docker)

`ENGINE_LAUNCHER=local` runs each task as an `agentic-bridge` child process of the app instead of a
container: own folder under `ENGINE_DATA_DIR/local-tasks/<id>`, own loopback port, a clone of
`ENGINE_REPO_URL` (a URL or a local path) on branch `agentic/<task-id>`. The bridge is the real one
(`agentic-bridge` must be on PATH) with an environment built explicitly, not inherited. The agent is
the fake agent by default (`ENGINE_LOCAL_AGENT=fake`: `tools/fake-agent/fake-agent.mjs`, no token reaches the bridge)
or Claude Code (`ENGINE_LOCAL_AGENT=claude`, which needs `CLAUDE_CODE_OAUTH_TOKEN` and costs real tokens).
There is **no isolation** between tasks or from the app: development only. The app logs a warning
at start-up. `ENGINE_MAX_RUNNING` applies as usual. Stopping the app (SIGINT/SIGTERM) stops the bridges.

```sh
PORT=3101 npm run start:local   # builds, then runs in the foreground; Ctrl-C stops it
```

`npm run start:local` (`tools/start-local.mjs`) runs `npm run build`, then `node dist/backend/main.js` with
`ENGINE_LAUNCHER=local`, `PORT` (default 3100) and `ENGINE_DATA_DIR=<checkout>/.local/<port>/`, which is wiped
and recreated at every start (`.local/` is git-ignored). Defaults that your environment overrides:
`ENGINE_REPO_URL` = the checkout itself (absolute path), `ENGINE_PROJECT` = the checkout's folder name,
`ENGINE_LOCAL_AGENT=fake`, `ENGINE_GIT_NAME`/`ENGINE_GIT_EMAIL` = a dummy identity. The script's pid is in
`.local/<port>.pid` (`kill $(cat .local/3101.pid)` stops the app and its bridges). Several checkouts or ports can run side by side.

The fake agent and `agentic-bridge` come from a checkout of this repository and the machine's PATH: the
`Dockerfile` image contains neither `tools/` nor the bridge, so use `local` from a checkout (the Docker image is for the `docker`
launcher). `tools/` is deliberately not copied into the image: `local` would still lack `agentic-bridge` there.

## Run in Docker

Two different images are involved:

- The **task image** (`ENGINE_IMAGE`) is the project's agentic-dev-base image, built with
  `agentic build` (for example tagged `agentic-pathfinder-dev-ui:local`). Task containers run it.
- The **UI image** is built from `Dockerfile` (Node 22, `npm ci`, `npm run build`, runs
  `node dist/backend/main.js` as user `node`, port 3000). It only contains this engine.

```sh
agentic build                       # the task image; note its tag for ENGINE_IMAGE
cp .env.example .env                # fill in secrets, ENGINE_IMAGE, ENGINE_REPO_URL, ENGINE_PROJECT, ENGINE_GIT_*
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

Push credentials: the task image configures git credentials only for the clone host during its own
start steps, so the engine also gives each task container the same git settings through
`GIT_CONFIG_COUNT` and `GIT_CONFIG_KEY_0..3`/`GIT_CONFIG_VALUE_0..3` for the host of the task's
repository (the same entries as `git_cred_env` in agentic-dev-base). Git then sends
`${GH_TOKEN:-$GIT_TOKEN}` to `https://<host>` and rewrites `git@<host>:` and `ssh://git@<host>/` to https,
so the agent can push without SSH keys. The values contain only the variable reference, never
the token, and nothing is written to a file. Commits are made as `ENGINE_GIT_NAME <ENGINE_GIT_EMAIL>`.

Secrets in container environments: each task container gets `CLAUDE_CODE_OAUTH_TOKEN`, `GH_TOKEN`,
its task token and its agent token as environment variables, so anyone who can run `docker inspect`
on it (anyone with Docker socket access, i.e. root-equivalent anyway) can read them; the same holds
for `CLAUDE_CODE_OAUTH_TOKEN` and `GH_TOKEN` in the `ui` container's environment (from `.env`). This
is accepted for now; API responses and container labels never contain them.

The Docker parts (`Dockerfile`, `compose.yaml`, `npm run test:docker`) were written without a Docker
daemon available and have not been run yet; `docker compose config` accepts the compose file.

## Test

| Command | What |
|---|---|
| `npm test` | Jest unit tests: backend (`backend/test/unit/`) and frontend (`frontend/test/`, jsdom + React Testing Library) |
| `npm run test:e2e` | Backend e2e tests (`backend/test/e2e/`, Jest + supertest; REST API with a fake launcher and a fake bridge). Needs a prior `npm run build` for the frontend tests. |
| `npm run test:bridge` | `backend/test/bridge/`: the real `agentic-bridge` as a local process with a fake agent (`tools/fake-agent/fake-agent.mjs`), driven through the bridge client, the task service and the REST API (local launcher). Skipped with a message on stderr where `agentic-bridge` is not on PATH. |
| `npm run test:docker` | `backend/test/docker/`: real Docker, real task image, fake agent: start a task, reach idle, prompt and see the echo, wake it after `docker stop`, stop it (a prompt is then refused with 409 without starting it), remove, check container and volume are gone. Needs both `ENGINE_IMAGE` (the task image) and `FAKE_AGENT_DIR` (directory holding agentic-dev-base's `bridge/test/fake-agent.mjs`, mounted at `/fake`), and a reachable Docker daemon (Linux Docker or Docker Desktop); otherwise skipped with a message on stderr. The test process never connects to container IPs: bridge requests run in a helper container from `ENGINE_IMAGE` on the test network (`node` with a small built-ins-only script, `backend/test/docker/bridge-request.cjs`) and reach the task by container name, as the UI does. It creates a temporary network, the helper container and a local git repository (bound into the task and cloned from there, no GitHub needed), and removes all of them, task containers and volumes in `afterAll`, also after a failure. Example: `ENGINE_IMAGE=agentic-pathfinder-dev-ui:local FAKE_AGENT_DIR=/path/to/agentic-dev-base/bridge/test npm run test:docker` |
| `npm run test:ui` | Playwright (`e2e/`). Builds and starts the app on port 3100, uses the Chromium under `PLAYWRIGHT_BROWSERS_PATH` if set. |
| `npm run lint` | ESLint for `backend/src/` and `backend/test/` |

## Launchers

A launcher runs task containers somewhere. The interface is `TaskLauncher` in
`backend/src/service/tasks/task-launcher.ts`:

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

1. Implement `TaskLauncher` in `backend/src/integration/tasks/launcher/` (it gets the `EngineConfig`).
2. Register it in `backend/src/integration/tasks/launcher/task-launcher.factory.ts` under a new name.
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
    integration/<area>/     external systems and runtimes: tasks/ bridge/ (HttpBridgeClient),
                            launcher/ (Docker and local launchers, factory); implements the service's interfaces
    repository/<area>/      storage only: system/ (package.json), tasks/ (task-record.repository.ts, JSON files)
    commons/                engine config, validation pipe, logging interceptor, exception filters, shared utilities
  test/
    unit/                   unit tests, mirroring src/
    e2e/                    Nest + supertest tests and their Jest config
    bridge/                 real-bridge suite (npm run test:bridge)
    docker/                 real-Docker suite (npm run test:docker)
    helpers/                fake bridge, fake and local-process launchers
tools/fake-agent/           fake agent (fake-agent.mjs): bridge suite and the local launcher
tools/start-local.mjs       npm run start:local
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

- Backend dependencies go only downwards: `api` → `service` → `integration` / `repository` → `commons`. Integration = external systems and
  runtimes (launchers, bridge client); repository = storage only. The service owns the interfaces it needs
  (`TaskLauncher`, `BridgeClient` and their tokens) and imports no integration class; only its Nest module
  imports the integration module.
- Each area has one Nest module per layer (`<Area>ApiModule`, `<Area>ServiceModule`,
  `<Area>IntegrationModule`, `<Area>RepositoryModule`); a layer's module imports only the module of the layer below.
- Routes are prefixed with the area: `/api/<area>/...`.
- Cross-cutting concerns (validation, logging, errors) live in pipes, interceptors and filters
  in `commons/`, registered globally in `app.setup.ts`, not in each method.
- Frontend: `views` → `state` → `api`.
