---
id: engine-repository
name: Task record repository
summary: "One mode-600 JSON file per task in ENGINE_DATA_DIR."
part: backend
layer: repository
module: tasks
sources:
  - backend/src/engine/repository/
talks_to:
  []
patterns: [repository]
status: draft
---

# Task record repository

## Purpose and boundary

One mode-600 JSON file per task in ENGINE_DATA_DIR. 

## Where changes go

Storage only.

## Contracts

Task records hold tokens.

## Invariants

Records are mode 600.

## Pitfalls

Never log or return a record directly.
