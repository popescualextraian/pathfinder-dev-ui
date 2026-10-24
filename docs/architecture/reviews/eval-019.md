# Eval: plan mode on plan 019 (plain task on a work item)

Review: `reviews/plans/2026-10-21-item-task.json` (written at 4954472 with today's doc). Real diff:
`4954472..e517d13`, 36 files, +894/-73, mapped with `agentic-arch affected` on e517d13 plus main's doc.

Notes: at 4954472 the architecture area did not exist, so `agentic-arch check` failed with 5 source-missing
problems (api-architecture, architecture-service, architecture-integration, and two `ArchitectPage*` sources of
frontend-views); the review JSON itself raised none. The doc already names "plain-task runs" in workflow-service
(written after 019), which could have hinted the answer.

## Components

| Component | Predicted | Touched | Result |
|---|---|---|---|
| workflow-service | changed | yes (`workflow-run.ts`, `workflow-runner.ts`, `workflow-tasks.ts`, `index.ts`) | hit |
| api-workflows | changed | yes (`start-task-run.dto.ts`, `workflow-runs.controller.ts`) | hit |
| workflow-integration | changed | yes (`engine-workflow-tasks.ts`) | hit |
| frontend-api | changed | yes (`models.ts`, `workflows-api.ts`) | hit |
| frontend-state | changed | yes (`use-workflow-runs.ts`, plus `use-route.ts`) | hit |
| frontend-views | changed | yes (10 files) | hit |
| workflow-repository, engine-*, backlog-* | not predicted | no | correct |

Hits 6, misses 0, false alarms 0. No component was new or removed, as predicted. Touched outside components:
tests, `e2e/workflow-plain-task.spec.ts` (omitted), README, `.gitignore` (omitted); the plan named the e2e spec and
README step, so those were expected.

Misses: none at component level. Small unpredicted detail inside a hit: `use-route.ts` (the open-task route after
start) changed in frontend-state; the review's line said "the app opens the task screen" under state, so it is covered.
False alarms: none.

## Findings and size

- Size M (six components, two layers, two parts, no new component): reasonable. Real work was about 340 source lines
  over 6 components; an M by the skill's rule of thumb (up to about six components).
- Rule breaks: both were `info`, no error or warn, and the plan broke no rule in practice (no layer or boundary
  change, workflow package still imports only commons). Right call on severity.
  - `solid/workflow-service/run-kind-overloads-workflow-run`: it landed as predicted. The builder chose the
    synthetic definition (`TASK_RUN_DEFINITION`, titled "Task", no steps) plus `kind?: 'task'` and an `isTaskRun`
    helper; the branching is in the runner and `workflow-run-view.ts`. Fair but low-value.
  - `clean-code/frontend-views/kickoff-prompt-built-in-view`: partly hit. `kickoffPrompt` is a pure function, but it
    lives in `views/workflow-run-view.ts`, not in state. Weak finding: the repository already keeps such pure view
    helpers there.
- Missed risk, not a rule break: no check was available for the plan's "old run files keep loading" claim; the
  diff handles it with an optional field only.

## Verdict

Good: component prediction was exact (6 of 6, no extras), size matched, and it correctly found no layer or boundary
break, consistent with a change that reused the existing run machinery. Off: the two findings are low-signal
(one is a taste call the repo contradicts), and a plan that is this contained mostly tests whether the doc maps
names to components, not whether the rules catch anything. The doc already described plain-task runs, so this result
may be flattered; a prediction against a doc from before 019 would be a stricter test.
