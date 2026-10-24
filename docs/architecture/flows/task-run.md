---
title: Start and run a task
---

# Start and run a task

A client posts a prompt; the engine starts a container and relays the agent's events until it ends.

1. api-tasks: validates the input and calls the engine service; bridge errors map to HTTP.
2. engine-service: checks `ENGINE_MAX_RUNNING` (409 beyond it), writes the task record, asks the launcher to start.
3. engine-integration: starts the container (or local process); it clones the repo itself, then the bridge starts.
4. engine-service: the poller talks to the bridge; an unreachable bridge with an ended container ends the task from `state.json`.
5. api-tasks: SSE streams status and events to frontend-api, which frontend-state hooks expose to the views.
