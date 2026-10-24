---
id: schedule-integration
name: Schedule adapter
summary: "EngineScheduledTasks adapter and its module."
part: backend
layer: integration
module: schedules
sources:
  - backend/src/integration/schedule/
talks_to:
  - { to: engine-service, via: call }
patterns: [adapter]
status: draft
---

# Schedule adapter

## Purpose and boundary

EngineScheduledTasks adapter and its module. 

## Where changes go

Adapter changes.

## Contracts

Implements `ScheduledTasks` on the engine index.

## Invariants

A scheduled run is an ordinary task with `scheduled` input.

## Pitfalls

None.
