---
style: modular-monolith
parts:
  - id: backend
    name: Backend
    layers:
      - { id: api, name: API, mayUse: [service, commons] }
      - { id: service, name: Service, mayUse: [repository, integration, commons] }
      - { id: integration, name: Integration, mayUse: [commons] }
      - { id: repository, name: Repository, mayUse: [commons] }
      - { id: commons, name: Commons, mayUse: [] }
    modules:
      - { id: tasks, name: Tasks engine }
      - { id: backlog, name: Backlog }
      - { id: workflows, name: Workflows }
      - { id: schedules, name: Schedules }
      - { id: architecture, name: Architecture }
      - { id: system, name: System and repositories }
  - id: frontend
    name: Frontend
    layers:
      - { id: views, name: Views, mayUse: [state] }
      - { id: state, name: State, mayUse: [api] }
      - { id: api, name: API client, mayUse: [] }
  - id: socket-filter
    name: Socket filter
    layers:
      - { id: filter, name: Filter, mayUse: [] }
boundaries:
  - { id: engine, folder: backend/src/engine, uses: [commons], entry: backend/src/engine/index.ts }
  - { id: backlog, folder: backend/src/backlog, uses: [commons], entry: backend/src/backlog/index.ts }
  - { id: workflow, folder: backend/src/workflow, uses: [commons], entry: backend/src/workflow/index.ts }
  - { id: schedule, folder: backend/src/schedule, uses: [commons], entry: backend/src/schedule/index.ts }
principles: [make-it-work, yagni, least-surprise, kiss, consistent, dry, clean-code, solid]
patterns: [ports-and-adapters, repository, adapter]
exceptions: []
---

# Architecture of pathfinder-dev-ui

A NestJS backend that serves a React frontend and runs one Docker container per agentic task, plus a
small socket filter in front of the Docker socket. The backend is one deployable cut into feature
modules; the frontend and the socket filter are separate builds that meet the backend only over HTTP
or the Docker socket.

## Style

Modular monolith, layered: the four optional or large areas (engine, backlog, workflow, schedule)
are self-contained packages with their own service, integration and repository folders behind an
`index.ts`; the other areas (architecture, system, repositories) are cut by layer at the top of
`backend/src`. The service owns the interfaces and injection tokens it needs and imports no
integration class; only its `<Area>ServiceModule` imports the integration module to wire the
implementation.

## Layers

- Backend `integration`: external systems and runtimes only (launchers, bridge client, GitLab, git).
  `repository`: storage only. `commons`: generic helpers, config and global pipes/filters; no module logic.
- Frontend: `views` render, `state` hooks hold behaviour, `api` is the only code that calls the backend.

## Rules

- Packages engine, backlog, workflow and schedule import nothing from the backend but `commons`, and
  are imported from outside only through their `index.ts` (enforced by `*-boundary.spec.ts`).
- Modules meet only through service interfaces; cross-package adapters live in `backend/src/integration/<area>/`.
- Controllers contain HTTP concerns only; validation, logging and error mapping are global (`app.setup.ts`).
- Task records and tokens never appear in responses, logs or container labels.
- Frontend: only `frontend/src/api` calls the backend.
- The socket filter is self-contained and imports nothing from `backend/`.
- Tests mirror the source tree.

## Exceptions

## Where to start

- Backend entry: `backend/src/main.ts`, `app.module.ts`; the engine's public face is `backend/src/engine/index.ts`.
- Busiest component: `workflow-service` (runner, definitions, generator).
- Main flow: see `flows/task-run.md`.
