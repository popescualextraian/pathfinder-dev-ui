# Manual test: backlog item 10, Better menu structuring

App: `PORT=3102 BACKLOG_CONFIG=e2e/fixtures/backlog.yaml WORKFLOWS_DIR=e2e/fixtures/workflows START_LOCAL_COPY_WORKFLOWS=1 npm run start:local` (backlog and workflows on), and `PORT=3103 npm run start:local` (both off). Driven with the Playwright MCP.

| # | Case | Expected | Result |
|---|------|----------|--------|
| 1 | Open `/` with backlog and workflows on | Navigation "Main navigation": heading Work (Backlog, Tasks), heading Automate (Workflows), no "Show", no Team; icons; Tasks active | Pass |
| 2 | Backlog count badge | Shows 2 (seeded items); Tasks shows open-task count | Pass |
| 3 | Click Backlog, Workflows, Tasks | Hash `#/backlog`, `#/workflows`, `#/`; only the current item has `aria-current` | Pass |
| 4 | Repository sub-list | Only visible on Tasks, under it; hidden on Backlog/Workflows; "All repositories" selected by default | Pass |
| 5 | Select a repository (`#/repo/<name>`) | That repository is marked current, Tasks stays current | Pass |
| 6 | Backlog and workflows off (3103) | Only Work > Tasks; no Automate heading, no Backlog/Workflows | Pass |
| 7 | Stale link `#/backlog` with backlog off | Tasks is marked current, no crash | Pass |
| 8 | Zero repositories / zero tasks | "All repositories 0" still shown | Pass (0 tasks); zero repositories not reproducible here (the checkout is always listed), covered by the unit test |
| 9 | Large badge (123456 forced into the Tasks badge) | Stays inside the button, no wrap, row height unchanged | Pass |
| 10 | Keyboard: Tab to items | Items are buttons with a visible 2px outline on focus | Pass |
| 11 | Created a task through the API, badge count | Tasks badge goes to 1 | Pass |

## Results
All 11 cases passed; no issues found, no code changed. The 404s in the console on the off-app are the existing feature probes (`/api/backlog/lanes`, `/api/workflows`).
Note: a stale Chromium from an earlier session held the Playwright profile; I killed it. I stopped the apps and deleted the test task.
