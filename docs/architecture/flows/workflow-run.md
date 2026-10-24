---
title: Workflow run on a backlog card
---

# Workflow run on a backlog card

1. api-workflows: starts a run for an item; the definition is snapshotted into the run file.
2. workflow-service: the runner starts steps through `WorkflowTasks` and follows task changes, no polling; a failed action is retried on a backoff timer.
3. workflow-integration: the adapter turns `WorkflowTasks` into engine-service calls and card moves into backlog-service moves.
4. backlog-service: a move writes through to GitLab (409 if the source lane disagrees) and emits a trigger event.
5. workflow-repository: each run state change is written to its mode-600 JSON file.
