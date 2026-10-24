---
id: api-workflows
name: Workflows API
summary: "Routes for workflow definitions, runs and generations, with their DTOs and error filter."
part: backend
layer: api
module: workflows
sources:
  - backend/src/api/workflows/
talks_to:
  - { to: workflow-service, via: call }
patterns: []
status: draft
---

# Workflows API

## Purpose and boundary

Routes for workflow definitions, runs and generations, with their DTOs and error filter. HTTP only; the module imports the workflow integration module directly to pass it to `WorkflowServiceModule.register`.

## Where changes go

Definitions, runs and generations each have a controller; shapes in `dto/`.

## Contracts

Routes `/api/workflows`, `/api/workflow-runs`; generations return 403 when the folder is read-only.

## Invariants

Optional: mounted only when workflows are configured.

## Pitfalls

The direct integration import is a wiring exception, not a pattern to copy.
