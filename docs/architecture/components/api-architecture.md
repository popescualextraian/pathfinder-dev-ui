---
id: api-architecture
name: Architecture API
summary: "Read-only routes for the architecture page and the architecture error filter."
part: backend
layer: api
module: architecture
sources:
  - backend/src/api/architecture/
talks_to:
  - { to: architecture-service, via: call }
patterns: []
status: draft
---

# Architecture API

## Purpose and boundary

Read-only routes for the architecture page and the architecture error filter. HTTP only; optional, mounted when `ARCHITECTURE_ENABLED=1`.

## Where changes go

Controller and `ArchitectureErrorFilter`.

## Contracts

`GET /api/architecture`, `/reviews`, `/reviews/:branch/:slug`, `/status`.

## Invariants

400 invalid names, 404 unknown, 422 invalid file, 502 unreadable repository.

## Pitfalls

`:branch` is one URL-encoded segment.
