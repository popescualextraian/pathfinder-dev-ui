# Workflows that carry a backlog item through its steps (task 012) — design

(Condensed verbatim from the approved task; binding.)

> Note (task 015): the file format below is superseded. A step no longer has `sessions:`; it has one `prompt` and optional
> `model`, `continue` and `fork` (each naming an earlier step). See README, Workflows, for the current format.

## Goal
HD starts a **workflow** on a backlog card. It creates one task for the item and runs its steps one after another.
Each step is one or more sessions of that task; the workflow moves the card into the step's lane. A step ends at a
**gate**: `human` (button "Continue") or `auto` (continue when the sessions are done). HD follows each step from the card
and opens its session in the task view. Part 2 of workflows (part 1: sessions, task 010).

## Decisions
- Generic engine: any steps, names, lanes, prompts; no step name known to the code.
- The workflow drives the card. Started from a card; task named after the item; workflow moves the card into each step's
  lane; a drag of a card with a running workflow never silently moves it.
- One task per run, one or more sessions per step, run sequentially.
- Step inputs: prompt template with item details; fresh or fork of an earlier session; `requires` files checked before the
  step (warning when missing); optional exit prompt sent before moving on. Steps hand work over via files in the worktree.
- Storage: YAML files in `WORKFLOWS_DIR` read through a repository interface (so the project repo's `.agentic/workflows/`
  can replace it later). Example workflows committed in the UI repo. Not now: editor, project-repo storage, catalog, PRs, "Open app".

## Workflow file (one YAML per workflow in WORKFLOWS_DIR; file name sans extension = id)
```yaml
title: Plan, implement, review
steps:
  - id: plan
    title: Plan
    stage: plan                     # work item's stage (backlog: lane id); card moves there when the step starts
    sessions:
      - name: main                  # first session of first step is the task's main session
        prompt: |
          You plan backlog item #{{item.id}}: {{item.title}}
          {{item.description}}
          Use superpowers:brainstorming with the human, then write the plan to plans/{{item.id}}.md.
    gate: human                     # human: wait for "Continue"; auto: go on when sessions are done
    exitPrompt: Make sure the plan is complete in plans/{{item.id}}.md and committed.
  - id: implement
    title: Implement
    stage: in-progress
    requires: [plans/{{item.id}}.md]
    sessions:
      - name: impl
        prompt: Implement plans/{{item.id}}.md, subagent-driven and test-first. Commit per step.
    gate: auto
  - id: review
    title: Review
    stage: review
    sessions:
      - name: review
        fork: impl                  # optional: start as a copy of that session's conversation
        model: sonnet               # optional
        prompt: Review the branch against plans/{{item.id}}.md and fix what is real.
    gate: human
doneStage: done                     # optional: where the card goes when the workflow ends
```
- `title` required. `steps` non-empty; each step: `id` (unique in workflow), `title`, `stage`, `sessions` (non-empty), `gate`
  (`human`|`auto`); optional `requires` (paths relative to worktree) and `exitPrompt`. Each session: `name` (bridge rule
  `[a-z0-9][a-z0-9_-]{0,31}`, unique in the workflow) and `prompt`; optional `fork` (an EARLIER session's name), `model`.
  Optional `doneStage`.
- First step's first session is the task's `main` session, so its name must be `main`. Later sessions use the sessions API (task 010).
- Placeholders in prompts, `exitPrompt`, `requires`: `{{item.id}} {{item.title}} {{item.description}} {{item.url}}
  {{task.id}} {{task.branch}} {{step.id}}`. Unknown placeholder = load error.
- Load validation: invalid YAML, broken rule, stage the work items don't have, fork from a non-earlier session → refused. Error names
  the file and problem; other files still load; the list API shows refused files with their errors.

## Backend
`backend/src/workflow/` is a package of its own with public `index.ts`, like engine and backlog; imports NOTHING but `commons`
(not engine, not backlog); a boundary spec checks it (model on `backend/test/unit/backlog/backlog-boundary.spec.ts`).
It owns the interfaces of what it needs; the rest of the app implements them:
- `WorkflowTasks`: `start({title, prompt, model?})` → task id; `addSession(taskId,{name,prompt,fork?,model?})`;
  `prompt(taskId, session, text)`; `get(taskId)` → task state and its sessions (state, open questions); `hasFiles(taskId, paths)`;
  `changes`: observable of task ids that changed.
- `WorkItems`: `get(itemId)` → `{id,title,description,url,stage}`; `moveTo(itemId, stage)`; optional `stages()` (backlog adapter: lane ids) used to validate at load.
Adapters outside the package (e.g. `backend/src/integration/workflow/`) implement these on the engine's and backlog's public surfaces;
a Nest module wires them. Words are generic: step has a `stage` (backlog: lane id); placeholders keep `{{item.*}}`.
- Repository layer: `WorkflowDefinitionRepository` (interface owned by service; file impl in repository layer) lists/reads definitions
  from `WORKFLOWS_DIR`, re-read on every list (no watcher). `WorkflowRunRepository`: one JSON file per run in `WORKFLOWS_DATA_DIR`
  (mode 600). Run has: `id`, `workflowId`, snapshot of the definition at start, `itemId`, `taskId`, current step index, per-session status,
  `state`, `warning`, times.
- Service: `WorkflowRunner`.
  - start(itemId, workflowId): refused (409) if the item has an active run. Starts task via `WorkflowTasks.start`: title `#<item.id> <item.title>`,
    first session's prompt filled in, default repository (adapter's choice), session's model. Records run; moves item to first step's stage.
  - Progress follows `WorkflowTasks.changes`, no extra polling. When a step's session is idle (no open question) after its turn, the next
    session of the step starts (`addSession` with fork/model). When the step's last session is done: gate `auto` → advance; gate `human` →
    run waits as `awaiting-approval`.
  - advance(runId) ("Continue" button / confirmed drag): 1. send step's `exitPrompt` to its last session if any, wait until done.
    2. check next step's `requires` in the task's worktree; if a file is missing the run waits as `blocked` with a warning naming the files;
    `force` ("Start anyway") overrides. 3. move card, start step's first session. After the last step: run `done`, card moves to `doneStage` if set.
  - stop(runId): marks `stopped`; task left as it is.
  - States: `running`, `needs-you` (a session of the run has an open question), `awaiting-approval`, `blocked`, `done`, `stopped`, `failed` (task failed/vanished, with reason).
  - After restart: reload active runs, reconcile with tasks; a task that is gone fails the run with a clear reason.
  - Publishes run changes on its own change stream like `TaskUpdates`.
- `requires` check: engine gets one small public method `TasksService.hasFiles(taskId, paths)`, implemented in launchers next to `readLedger`:
  Docker with the archive API; local with the file system in the task's worktree as the agent sees it. Paths relative, no `..`, checked in the
  API's DTO and again in the launcher.
- API `backend/src/api/workflows`, DTO validation: `GET /api/workflows` (definitions: id, title, step ids/titles/stages; plus refused files with errors);
  `GET /api/workflow-runs?itemId=` (active and recent); `POST /api/workflow-runs {itemId, workflowId}` (409 if active);
  `POST /api/workflow-runs/:id/advance {force?}`; `POST /api/workflow-runs/:id/stop`; `GET /api/workflow-runs/stream` SSE like tasks stream.
- Wiring: workflow modules load only when `BACKLOG_CONFIG` and `WORKFLOWS_DIR` both set (else no routes, no buttons). `WORKFLOWS_DATA_DIR` required with them.
- Lanes' `trigger` events unchanged; runner doesn't use them.

## Frontend
- API and state: workflow calls and run stream; views do not call the API.
- Card: no run → small "▶ Workflow" button opens picker of definitions (one click when only one), then a confirm step. With a run: run line with workflow title,
  current step (`Plan · 1/3`), run state (marked when needs-you, awaiting-approval, blocked, failed). Buttons: **Open step** (`#/tasks/<taskId>?session=<current session>`);
  **Continue → <next step title>** when awaiting approval (**Finish** after last step); **Start anyway** when blocked (warning shown); **Stop workflow** (asks confirmation).
- Item detail panel: same plus list of steps with state (done/current/next).
- Board drag of a card with an active run: drop on the lane of the NEXT step while awaiting approval asks "Continue the workflow to <step>?" and advances on yes.
  Any other drop refused with message "This card is driven by its workflow"; card stays.
- Task view: if the task belongs to a run, small line under the title "Workflow <title> · step <title>" with a link back to the board item.

## Examples and docs
`workflows.example/plan-implement-review.yaml` (above) and `workflows.example/implement-review.yaml` (two steps, auto then human), both valid against
`backlog.example.yaml`'s lanes. README "Workflows" section: file format, placeholders, gates, run states, the three variables, API.
