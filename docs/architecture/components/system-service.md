---
id: system-service
name: System and repositories service
summary: "System info and the configured repository list."
part: backend
layer: service
module: system
sources:
  - backend/src/service/system/
  - backend/src/service/repositories/
talks_to:
  - { to: system-repository, via: call }
patterns: []
status: draft
---

# System and repositories service

## Purpose and boundary

System info and the configured repository list. Small services.

## Where changes go

`system.service.ts`, `repositories.service.ts`.

## Contracts

None beyond the service API.

## Invariants

None.

## Pitfalls

None.
