---
id: api-schedules
name: Schedules API
summary: "Routes under /api/schedules and the schedule error filter."
part: backend
layer: api
module: schedules
sources:
  - backend/src/api/schedules/
talks_to:
  - { to: schedule-service, via: call }
patterns: []
status: draft
---

# Schedules API

## Purpose and boundary

Routes under /api/schedules and the schedule error filter. HTTP only; imports the schedule integration module directly for wiring.

## Where changes go

Controller and error filter here; validation is the service's `validateSchedule`, there are no DTO classes.

## Contracts

Routes `/api/schedules` plus `/:id/run` and `/preview`.

## Invariants

Errors carry the offending `field`.

## Pitfalls

Do not add DTO classes; the one validator serves the API.
