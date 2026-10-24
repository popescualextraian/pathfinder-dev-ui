---
id: frontend-state
name: Frontend state
summary: "Hooks that load, stream and mutate through the API client."
part: frontend
layer: state

sources:
  - frontend/src/state/
talks_to:
  - { to: frontend-api, via: call }
patterns: []
status: draft
---

# Frontend state

## Purpose and boundary

Hooks that load, stream and mutate through the API client. Hooks, route parsing, drafts.

## Where changes go

One hook per area in `state/use-*.ts`.

## Contracts

URL hash state holds repository, task and session.

## Invariants

Streams are opened only while their view is mounted.

## Pitfalls

Do not call `fetch` here.
