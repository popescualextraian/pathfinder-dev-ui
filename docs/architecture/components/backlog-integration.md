---
id: backlog-integration
name: Backlog connectors
summary: "GitLab connector and the in-memory test connector."
part: backend
layer: integration
module: backlog
sources:
  - backend/src/backlog/integration/
talks_to:
  []
patterns: [adapter]
status: draft
---

# Backlog connectors

## Purpose and boundary

GitLab connector and the in-memory test connector. 

## Where changes go

GitLab or memory connector changes.

## Contracts

Implements `BacklogConnector`.

## Invariants

The token never appears in logs, responses or files.

## Pitfalls

The memory connector is refused unless `BACKLOG_ALLOW_MEMORY_CONNECTOR=1`.
