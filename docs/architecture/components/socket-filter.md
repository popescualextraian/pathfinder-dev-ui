---
id: socket-filter
name: Docker socket filter
summary: "A Unix-socket HTTP proxy that allows only what DockerTaskLauncher sends, only for task containers."
part: socket-filter
layer: filter

sources:
  - socket-filter/
talks_to:
  []
patterns: []
status: draft
---

# Docker socket filter

## Purpose and boundary

A Unix-socket HTTP proxy that allows only what DockerTaskLauncher sends, only for task containers. Rules in `src/rules.ts` (pure `decide`), kept in sync with `socket-filter/README.md`.

## Where changes go

A Docker call change in the launcher changes the allowlist.

## Contracts

No runtime dependencies; imports nothing from `backend/`.

## Invariants

Do not widen the rules to make a launcher change pass.

## Pitfalls


