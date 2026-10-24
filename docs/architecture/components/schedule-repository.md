---
id: schedule-repository
name: Schedule file repository
summary: "One mode-600 JSON per schedule with its last 50 results."
part: backend
layer: repository
module: schedules
sources:
  - backend/src/schedule/repository/
talks_to:
  []
patterns: [repository]
status: draft
---

# Schedule file repository

## Purpose and boundary

One mode-600 JSON per schedule with its last 50 results. 

## Where changes go

Storage only.

## Contracts

Last 50 results kept.

## Invariants

Mode 600.

## Pitfalls

None.
