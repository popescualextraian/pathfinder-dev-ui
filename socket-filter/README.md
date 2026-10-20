# socket-filter

A small HTTP proxy for the Docker API that sits between the UI/engine and `/var/run/docker.sock`. The UI
only needs to create, start, stop, inspect, copy from and remove its own task containers and volumes; the raw
socket would give it root on the host. The filter serves the narrowed API and answers everything else
`403 {"message":"docker-filter: <why>"}`.

Self-contained: own `package.json`, `tsconfig`, `Dockerfile` (node:22-slim, runs as `node`), tests. No runtime dependencies, nothing imported from `backend/`.
Tests: `npm run test:filter` from the repository root (fake daemon on a Unix socket); `npm run test:docker:filter` (real Docker).
The rules are the pure function `decide` in `src/rules.ts`; the server (`src/server.ts`) applies the decision.

## Running

It listens on a Unix socket only (never TCP), mode 0660, created at start (a stale socket is removed; a
non-socket file there stops the start). In `compose.yaml` the service `docker-filter` mounts the real socket, shares the socket directory
with `ui` through the volume `docker-filter`, and has no network, a read-only root, no capabilities, `no-new-privileges`
and `group_add: DOCKER_GID`.

| Variable | Meaning |
|---|---|
| `FILTER_IMAGE` | required: the only image task containers may run (= `ENGINE_IMAGE`) |
| `FILTER_NETWORK` | required: the only network they may join (= `ENGINE_DOCKER_NETWORK`); `host`, `none`, `bridge`, `default` are refused |
| `FILTER_LISTEN` | required, absolute: the filtered socket |
| `FILTER_UPSTREAM` | absolute, default `/var/run/docker.sock`; must differ from `FILTER_LISTEN` |
| `FILTER_NAME_PREFIX` | default `agentic-ui-task-` |
| `FILTER_LABEL_PREFIX` | default `agentic-ui.` |
| `FILTER_KIND_LABEL` | default `agentic-ui.kind=task`; key under the label prefix |
| `FILTER_DEBUG` | `1` or `true` logs allowed requests too |

A bad or missing value stops the start, naming the variable, never printing a value.
Logging: one line per refused request (method, path without query, reason). Env values, tokens and bodies are never logged.

## Rules

Everything not listed is refused (exec, attach, logs, build, images, networks, plugins, swarm, events, commit,
update, rename, kill, PUT archive, other containers, ...).

Requests in general:
- HTTP/1.1; an optional `/v1.NN` prefix is accepted. The path must match a route literally: percent-encoding, `..`, `.`, double or
  trailing slashes, upper case, backslash, `;`, fragments, absolute-URI and `*` targets are refused.
- Every connection upgrade/hijack (`Upgrade`, `Connection: upgrade`), `CONNECT` and `OPTIONS` are refused.
- Body at most 1 MB; the body must be valid UTF-8 JSON without duplicate keys (at any depth, also via escapes) and without `__proto__`. Endpoints without a body refuse one.
- Query and JSON bodies are checked and then rebuilt from the validated values; the daemon only gets what the filter built (its own headers too, so client framing tricks and `X-Registry-Auth` do not pass).
- Names are `<prefix>[A-Za-z0-9-]+`; the task id is the part after the prefix.

| Request | Allowed when |
|---|---|
| `GET /_ping`, `HEAD /_ping`, `GET /version` | always, no query |
| `POST /volumes/create` | body keys only `Name`, `Labels`, `Driver`; `Name` is a task name; `Driver` absent or `local`; labels all under the label prefix, kind label present, `<prefix>task` equals the id in the name. No `DriverOpts` (a `local` volume with `o=bind` would be a disguised bind mount). |
| `POST /containers/create?name=<name>` | `name` is a task name; body keys only `Image`, `name`, `Cmd`, `Labels`, `Env`, `HostConfig`; `Image` is `FILTER_IMAGE`; `Cmd` is `["agentic-bridge"]`; labels as for volumes; `Env` free (list of strings; never logged); `HostConfig` keys only `Binds`, `NetworkMode`, `CapDrop`, `SecurityOpt` with `Binds` exactly `["<name>:/task"]`, `NetworkMode` = `FILTER_NETWORK`, `CapDrop` `["ALL"]`, `SecurityOpt` `["no-new-privileges"]`. So no `Privileged`, `Mounts`, host-path binds, `CapAdd`, ports, devices, `Entrypoint`, `User`, ... |
| `POST /containers/<name>/start` | task name, or exactly one full 64-hex container id (the launcher starts a new container by the id that create returns); no query, no body; label check |
| `POST /containers/<name>/stop` | task name; query `t` (seconds) only; a body only if it is exactly `{"t":<same>}`; label check |
| `DELETE /containers/<name>` | task name; query `force`, `v` (booleans); label check |
| `GET /containers/<name>/json` | task name; no query; label check |
| `GET` or `HEAD /containers/<name>/archive` | task name; query `path` only; label check |
| `DELETE /volumes/<name>` | task name; no query; label check |
| `GET /containers/json` | query `filters` and `all` only; the kind label is added to the label filter (both the list and the map form of `filters`), so other containers are never listed; unparseable filters are refused |

Only start accepts a container id; every other action by id (stop, delete, inspect, archive) is refused.
There is no exec, and no way to start a container the filter did not create or create one other than a task container.

### Label check

For container actions (start, stop, delete, json, archive) and `DELETE /volumes/<name>` the filter first inspects the
resource upstream with the same reference (`GET /containers/<name>/json`, `GET /volumes/<name>`). A non-200 answer (404) is passed on as is;
a 200 without the kind label, or for another name or id, is refused 403. Then the action is forwarded.

TOCTOU: the container could be replaced between the inspect and the action. Only someone with raw socket
access could do that (the filter always creates task containers with the labels), so this is accepted.

### What the real launcher sends

Findings from running dockerode (`DockerTaskLauncher`) through the filter:
- docker-modem copies all options into the query as well as the body, so create arrives as `?Image=..&name=..&Cmd=..&Labels=..&Env=..&HostConfig=..`
  (the environment, i.e. tokens, would be in the URL), volume create as `?Name=..&Labels=..`. The filter accepts exactly these mirrored keys,
  drops them, and forwards only `?name=<name>`; any other key (`platform`, ...) is refused.
- `stop` sends `?t=10` and the body `{"t":10}`; the body is dropped.

### Consequences

- `ENGINE_TASK_EXTRA_BINDS` makes every launch fail with 403 `Binds not allowed` (the launcher removes the volume again).
- The filter limits what the UI can ask the daemon for. It does not make the filter container itself harmless: it still holds the raw socket.
