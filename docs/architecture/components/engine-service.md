---
id: engine-service
name: Task engine service
summary: "Task lifecycle: start, poll, wake, events, cost; owns the TaskLauncher and BridgeClient interfaces."
part: backend
layer: service
module: tasks
sources:
  - backend/src/engine/index.ts
  - backend/src/engine/service/
talks_to:
  - { to: engine-integration, via: call }
  - { to: engine-repository, via: call }
patterns: []
status: draft
---

# Task engine service

## Purpose and boundary

Task lifecycle: start, poll, wake, events, cost; owns the TaskLauncher and BridgeClient interfaces. Start/stop tasks, poller, SSE relay, task end detection. It imports nothing outside `engine/` but `commons`.

## Where changes go

Lifecycle in `tasks.service.ts`, polling in `task-poller.ts`, end reasons in `task-end.ts`, interfaces in `task-launcher.ts` and `bridge-client.ts`.

## Contracts

`engine/index.ts` is the only way in from outside; `TaskLauncher` and `BridgeClient` are the ports.

## Invariants

`ENGINE_MAX_RUNNING` caps running containers (409); a task stopped via `/stop` is final; records never leak tokens.

## Pitfalls

Do not import launcher classes here; `TasksServiceModule` is the only wiring point.
