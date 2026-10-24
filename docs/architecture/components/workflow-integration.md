---
id: workflow-integration
name: Workflow adapters
summary: "EngineWorkflowTasks and BacklogWorkItems adapters and the workflow integration module."
part: backend
layer: integration
module: workflows
sources:
  - backend/src/integration/workflow/
talks_to:
  - { to: engine-service, via: call }
  - { to: backlog-service, via: call }
patterns: [adapter, ports-and-adapters]
status: draft
---

# Workflow adapters

## Purpose and boundary

EngineWorkflowTasks and BacklogWorkItems adapters and the workflow integration module. 

## Where changes go

Adapter changes; this folder is where workflows meet engine and backlog.

## Contracts

Implement `WorkflowTasks` and `WorkItems` on the packages' `index.ts`.

## Invariants

Also builds the file repositories.

## Pitfalls

Stays the only code that knows both sides.
