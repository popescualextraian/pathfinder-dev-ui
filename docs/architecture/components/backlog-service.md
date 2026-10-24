---
id: backlog-service
name: Backlog service
summary: "Lanes, items and moves over a BacklogConnector; emits trigger events for moves."
part: backend
layer: service
module: backlog
sources:
  - backend/src/backlog/index.ts
  - backend/src/backlog/service/
talks_to:
  - { to: backlog-integration, via: call }
  - { to: backlog-repository, via: call }
patterns: []
status: draft
---

# Backlog service

## Purpose and boundary

Lanes, items and moves over a BacklogConnector; emits trigger events for moves. Optional; on only when `BACKLOG_CONFIG` is set. Owns the connector interface.

## Where changes go

Moves and edits in `backlog.service.ts`; polling in `backlog-poller.ts`.

## Contracts

`backlog/index.ts`; trigger events only for moves through `BacklogService.move`; create and edit never emit.

## Invariants

GitLab is the source of truth; a lane label has no comma, does not repeat, at most one lane is closed.

## Pitfalls

Do not let a create or edit emit a trigger event.
