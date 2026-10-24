---
id: frontend-api
name: Frontend API client
summary: "The only code that calls the backend: fetch, SSE and typed models."
part: frontend
layer: api

sources:
  - frontend/src/api/
talks_to:
  []
patterns: []
status: draft
---

# Frontend API client

## Purpose and boundary

The only code that calls the backend: fetch, SSE and typed models. Endpoints in `*-api.ts`, streams in `*-stream.ts`, types in `models.ts`.

## Where changes go

`ApiError`; SSE reconnects from the last seq.

## Contracts

All backend models are typed in one place.

## Invariants

None.

## Pitfalls


