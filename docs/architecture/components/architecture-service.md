---
id: architecture-service
name: Architecture service
summary: "Reads and validates docs/architecture files of configured repositories through RepositoryFiles."
part: backend
layer: service
module: architecture
sources:
  - backend/src/service/architecture/
talks_to:
  - { to: architecture-integration, via: call }
patterns: []
status: draft
---

# Architecture service

## Purpose and boundary

Reads and validates docs/architecture files of configured repositories through RepositoryFiles. Owns `RepositoryFiles` and the one hand-written validator.

## Where changes go

Validation in `architecture-validator.ts`, logic in `architecture.service.ts`.

## Contracts

Error classes in `architecture-errors.ts`; first error as `<file>: <path>: <message>`.

## Invariants

Branch and path are validated before any git call.

## Pitfalls

A bad `full.json` does not hide the grid.
