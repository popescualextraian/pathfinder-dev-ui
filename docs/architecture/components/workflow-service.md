---
id: workflow-service
name: Workflow service
summary: "Workflow definitions, the runner that follows task changes, runs, plain-task runs and the generator."
part: backend
layer: service
module: workflows
sources:
  - backend/src/workflow/index.ts
  - backend/src/workflow/service/
talks_to:
  - { to: workflow-integration, via: call }
  - { to: workflow-repository, via: call }
patterns: []
status: draft
---

# Workflow service

## Purpose and boundary

Workflow definitions, the runner that follows task changes, runs, plain-task runs and the generator. Owns the interfaces `WorkflowTasks` and `WorkflowItems`; optional (needs backlog and workflows dir).

## Where changes go

Runner in `workflow-runner.ts`, one validator for files and editor, generator under `generator/`, skill text in `generator/workflow-author.md`.

## Contracts

`workflow/index.ts`; the run snapshot of the definition; format with one `prompt` per step.

## Invariants

A format change updates the skill file; runs saved in the old format are converted on load.

## Pitfalls

Do not poll tasks; follow `WorkflowTasks.changes`.
