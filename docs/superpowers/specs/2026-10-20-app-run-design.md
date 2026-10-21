# Apps in a task: publish, open and control them from the UI

Status: designed, 2026-10-20. The task side (config, `agentic-app`, bridge routes, `app` events) is in
pathfinder-dev-base: `docs/specs/2026-10-20-app-run-design.md`.

## 1. Outcome

In the task view a user sees the task's apps, starts and stops them, reads their logs and opens them in the browser
at `http://localhost:<port>`. The look follows this app's existing design and colours; nothing is restyled.

Success criteria:

- A task container created by the Docker launcher has every app port of its image published on `127.0.0.1` with a
  random host port; the host ports are kept in the task record.
- `GET /api/tasks/:id/apps` lists each app with its state and `http://localhost:<hostPort><url>`; start, stop,
  restart and logs relay to the bridge.
- The task view shows one line per app with Open, Logs, Restart and Stop (or Start), updated from `app` events.
- The local launcher shows "Apps need the Docker launcher" and offers no actions.
- No token in a label, a response or a log; `npm test`, `npm run lint` and `npm run test:e2e` pass; `npm run
  test:docker` covers a real app.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| U-1 | **Docker launcher only.** | Isolated ports per task; local processes would collide on the same port. |
| U-2 | **Ports from the image label `agentic.apps`**, published at container creation (`ExposedPorts`, `PortBindings` to `127.0.0.1` with a random host port), read back from the container. | Ports cannot be added to a running container. |
| U-3 | **App control through the bridge client**, like prompts. | The launcher only creates containers. |
| U-4 | **The existing look**: existing components (`Button`, `StatePill`, `FactsPanel`) and CSS modules; no new colours. | The user's rule for this app. |

## 3. Backend

- Engine (`backend/src/engine`): `DockerTaskLauncher` reads `agentic.apps` from the image (missing or invalid →
  no apps), adds the port bindings, and returns `{appPorts: {name: {containerPort: hostPort}}}` with the bridge
  URL; the task record keeps it. `BridgeClient` gains `apps()`, `appAction(name, action)`, `appLogs(name, lines)`.
  `TasksService` gains the same, refusing a task stopped via `/stop` (409) and a local-launcher task (409 "apps
  need the Docker launcher").
- API (`backend/src/api/tasks`): `GET /api/tasks/:id/apps`, `POST /api/tasks/:id/apps/:name/(start|stop|restart)`,
  `GET /api/tasks/:id/apps/:name/logs?lines=N`; names validated (`^[a-z][a-z0-9-]{0,30}$`), lines 1–2000.
  Bridge errors map as today (`bridge-error.filter.ts`).
- `app` events reach the full-run SSE stream unchanged; the status stream needs no change.

## 4. Frontend

`api/tasks-api.ts` and `models.ts` gain the app calls and type; `state/` keeps the app list per task (refetched on
an `app` event); `views/TaskView.tsx` gets an apps section built from existing components: per app the name, a
`StatePill`, the link `localhost:<port>` (opens in a new tab, `rel="noopener noreferrer"`), and Buttons Logs,
Restart, Stop or Start. Logs open in the existing panel style, monospaced, as text.

## 5. Testing

Unit: label parsing and port bindings in the launcher; service refusals; API validation. e2e: fake bridge with
apps (list, actions, logs, errors). Frontend (jsdom): the apps section per state, events refreshing it. Docker
(`test:docker`): a task image with a tiny HTTP app, start through the API, fetch it on the published port.

## 6. Out of scope

The local launcher, VS Code attach, app preview inside the page, changing the app's look.
