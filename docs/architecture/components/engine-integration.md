---
id: engine-integration
name: Task engine integration
summary: "Docker and local launchers and the HTTP/WebSocket bridge client."
part: backend
layer: integration
module: tasks
sources:
  - backend/src/engine/integration/
talks_to:
  []
patterns: [adapter]
status: draft
---

# Task engine integration

## Purpose and boundary

Docker and local launchers and the HTTP/WebSocket bridge client. 

## Where changes go

Launcher or bridge changes go here; a Docker call change also changes the socket filter allowlist.

## Contracts

Implements `TaskLauncher` and `BridgeClient`; the launcher only returns a bridge base URL.

## Invariants

Git push credentials come from `GIT_CONFIG_*` env, never a token value.

The Docker launcher reads the image labels `agentic.layout`/`agentic.target`/`agentic.workspaces` and, for a target, sets `AGENTIC_LAYOUT`/`AGENTIC_WORK`/`AGENTIC_TARGET` and reads files below `/work/.worktrees/<id>/<target>`. The local launcher is never multi and refuses a target.

## Pitfalls

The local launcher has no isolation and is development only.
