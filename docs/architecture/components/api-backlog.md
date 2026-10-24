---
id: api-backlog
name: Backlog API
summary: "REST routes under /api/backlog and the backlog error filter."
part: backend
layer: api
module: backlog
sources:
  - backend/src/api/backlog/
talks_to:
  - { to: backlog-service, via: call }
patterns: []
status: draft
---

# Backlog API

## Purpose and boundary

REST routes under /api/backlog and the backlog error filter. HTTP only.

## Where changes go

Controllers and DTOs here; moves, creates and edits are service work.

## Contracts

Routes under `/api/backlog`.

## Invariants

A move to an unknown lane is 400; a move whose source disagrees is 409.

## Pitfalls

The token must never reach a response.
