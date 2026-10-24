---
id: api-system
name: System and repositories API
summary: "Health, system info and repository list routes."
part: backend
layer: api
module: system
sources:
  - backend/src/api/system/
  - backend/src/api/repositories/
talks_to:
  - { to: system-service, via: call }
patterns: []
status: draft
---

# System and repositories API

## Purpose and boundary

Health, system info and repository list routes. HTTP only.

## Where changes go

One controller per area.

## Contracts

`/api/health`, `/api/system`, `/api/repositories`.

## Invariants

Health stays unauthenticated and cheap.

## Pitfalls

None.
