---
id: workflow-repository
name: Workflow file repositories
summary: "YAML definitions, run JSON and generation files."
part: backend
layer: repository
module: workflows
sources:
  - backend/src/workflow/repository/
talks_to:
  []
patterns: [repository]
status: draft
---

# Workflow file repositories

## Purpose and boundary

YAML definitions, run JSON and generation files. 

## Where changes go

Storage only.

## Contracts

Content-hash `version` on definitions.

## Invariants

Run files are mode 600.

## Pitfalls

The definition repository needs `WORK_ITEMS` to validate stages.
