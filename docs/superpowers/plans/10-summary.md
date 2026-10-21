# Backlog item 10: Better menu structuring, tester summary

## What was implemented
Frontend only, as in `docs/superpowers/plans/10.md`. The sidebar's "Show" switch is replaced by grouped navigation with icons:
- **Work**: Backlog (only when the backlog is on), Tasks.
- **Automate**: Workflows (only when workflows are on).
- A group with no visible item is not shown. There is no Team group yet and there are no placeholders.
- New `NavItem` view and inline icons (`nav-icons.tsx`). Items are 15px with the red active bar and `aria-current`. Count badges: open tasks on Tasks, item count on Backlog.
- The repository filter is now a sub-list under Tasks, shown only on the Tasks view. It still shows "All repositories (0)" with no repositories.
- The sidebar landmark is now named "Main navigation". Routes, URLs and the backend are unchanged. The name stays "Tasks" and the button stays "+ New task".
- `CLAUDE.md` Frontend section updated.

## What changes for the user
The Backlog/Tasks/Workflows switch becomes a grouped menu with icons. The repository list moves under Tasks and disappears on other views.

## How to start
`PORT=3101 npm run start:local > /tmp/app-3101.log 2>&1 &`. Wait for "successfully started" in the log, then open http://localhost:3101. Stop with `kill $(cat .local/3101.pid)`.
To see Backlog and Workflows, add `BACKLOG_CONFIG=e2e/fixtures/backlog.yaml WORKFLOWS_DIR=e2e/fixtures/workflows`.

## Deviations and things to check
- After the final review I added a fix: a view whose area is off (a stale `#/backlog` link, or the backlog still loading) marks Tasks as current.
- Leaving Tasks resets the repository filter to All. Routes never carried the filter, and changing that would be a routing change. This is why the plan's App test "keeps the selected repository" was not kept. The ruling is in the spec's "As built" section.
- Known gaps: some new CSS uses raw `rgba(255,255,255,..)` instead of theme variables. There is no test for a very large count badge (for example 1234), so check that by eye.
- Verification run at the end (this container): `npm run build` and `npm run lint` pass. `npm test`: 1781/1783 pass; the 2 failures are `local-task-launcher` "kills a grandchild" timeouts, and there is no backend diff on this branch. `npm run test:ui`: 9-11 of 12 pass. The failing tests differ from run to run (sessions, tasks lifecycle, workflow-editor and workflows specs, which wait for task or bridge runs and time out). None of them fail on a sidebar selector. I treat them as environmental flakiness, not as caused by this change. I did not check them against `main`, so please re-run `npm run test:ui` on a normal machine.
- The commits for steps 1-3 already existed on this branch when this run started.
