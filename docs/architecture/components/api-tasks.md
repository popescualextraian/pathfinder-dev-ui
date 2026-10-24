---
id: api-tasks
name: Tasks API
summary: "REST and SSE routes for tasks, sessions and the task event stream."
part: backend
layer: api
module: tasks
sources:
  - backend/src/api/tasks/
talks_to:
  - { to: engine-service, via: call }
patterns: []
status: draft
---

# Tasks API

## Purpose and boundary

REST and SSE routes for tasks, sessions and the task event stream. Controller, DTOs and the bridge error filter.

## Where changes go

HTTP concerns go in `tasks.controller.ts`, input shapes in `dto/`, status mapping in the filters. Behaviour goes to the engine service.

## Contracts

Routes under `/api/tasks`; public `POST /api/tasks` strips the internal task fields (kind, schedule).

## Invariants

Bridge errors map to 400/404/409/503, anything else 502.

## Pitfalls

Do not put task logic here; DTO limits come from `commons/task-input-rules`.
