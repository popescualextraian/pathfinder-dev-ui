# Workflows (task 012) plan
Spec: docs/superpowers/specs/2026-10-20-workflows-design.md. Each task test-first, one commit each; run tests before commit; do not push.

## Task 1: Definitions
YAML parser + validation + file repository in `backend/src/workflow/` (service/repository layers, boundary: commons only). Unit tests: valid example; each rule broken; unknown placeholder; fork to later session; unknown stage; one bad file among good ones.
## Task 2: Engine hasFiles
`TasksService.hasFiles(taskId, paths)`, in both launchers (`TaskLauncher` interface). Tests: local temp folder; Docker mocked dockerode; `..` refused.
## Task 3: Runs and the runner
Run repository + `WorkflowRunner` with fakes of `WorkflowTasks`/`WorkItems`. Tests for everything listed in the spec's runner section (start, 409, next session, auto/human gate, exit prompt, requires+force, fork/model, needs-you, done+doneStage, stop, vanished task→failed, reload).
## Task 4: Adapters and API
Engine and backlog adapters (unit tests on fakes), routes, DTOs, SSE stream, Nest wiring on env vars (`app.module.ts`, engine-config style validation), controller tests, boundary spec of `workflow`.
## Task 5: Frontend API and state
`frontend/src/api` + `state` hooks. Unit tests.
## Task 6: Frontend views
Card, detail panel, board drag, task view line. Testing Library tests.
## Task 7: E2E
Backend e2e of the run flow (local launcher/fake agent or fake launcher, fake connector) plus smaller Playwright test needing an in-memory connector allowed only by `start:local`.
## Task 8: Examples and README
