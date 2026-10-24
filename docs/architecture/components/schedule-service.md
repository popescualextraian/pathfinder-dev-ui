---
id: schedule-service
name: Schedule service
summary: "Schedules, the ticking runner and run results; owns ScheduledTasks and the repository interfaces."
part: backend
layer: service
module: schedules
sources:
  - backend/src/schedule/index.ts
  - backend/src/schedule/service/
talks_to:
  - { to: schedule-integration, via: call }
  - { to: schedule-repository, via: call }
patterns: []
status: draft
---

# Schedule service

## Purpose and boundary

Schedules, the ticking runner and run results; owns ScheduledTasks and the repository interfaces. Always on; one validator `validateSchedule`.

## Where changes go

Time math in `schedule-time.ts`, ticking in `schedule-runner.ts`.

## Contracts

`schedule/index.ts`; late by more than two ticks is `missed`; one at a time per schedule through `ScheduleLocks`.

## Invariants

All work on one schedule goes through `ScheduleLocks`.

## Pitfalls

A timer per schedule is wrong; one `setInterval` ticks all.
