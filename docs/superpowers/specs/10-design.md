# Backlog item 10: Better menu structuring (design)

## Intent
The left menu does not feel natural. "Show" is a generic label that could hold anything, the destinations (Tasks, Backlog, Workflows) are small 14px text styled like a footnote, and the repository filter (which only applies to Tasks) sits above the navigation so it reads as the main menu. The menu must follow common navigation practice and have room for coming areas (Agentic Colleagues, Task Scheduling, others) without another redesign.

## Decisions (agreed with the human)
- Navigation is grouped by intent, with section labels:
  - **Work**: Backlog, Tasks
  - **Automate**: Workflows (later: Schedules)
  - **Team**: (later: Colleagues)
- Every destination is a real nav item: icon, 15px label, clear active state (existing red inset bar), optional count badge (Tasks: number of tasks, Backlog: number of items).
- Areas that do not exist yet are absent (no greyed placeholders). Each future area has a named home group. A group with no visible item is not rendered.
- The repository filter becomes a contextual sub-list under the Tasks item, shown only while Tasks is the active view (selected: "All repositories" or one repository, with counts). It no longer sits above the navigation.
- **Naming stays "Tasks"** and "+ New task" stays (the human decided; "Runs"/"Agent runs" were considered and rejected). The mockup (`assets/10-mockup.png`) now shows the final labels.
- Order inside Work: Backlog first (the thing to be done), then Tasks (the agent working on it). Brand and the primary "+ New task" button stay at the top.
- Existing visibility rules stay: Backlog only when the backlog is on, Workflows only when workflows are on. With the backlog off, only Tasks shows.

## Goals
- Clear, readable, conventional menu; adding an area later is one entry in a list, not new layout code.
- URLs, routes (`#/repo/..`, `#/backlog`, `#/workflows`), keyboard access and `aria-current` behave as today.

## Non-goals
- No renaming of Tasks, no API or backend change, no new areas (Schedules, Colleagues, Settings are not built here).
- No collapsible/responsive/mobile sidebar, no change to the system-info footer.

## Anti-goals
- Placeholder entries for unbuilt features; a menu that needs layout changes for each new area; losing the repository filter or its counts.

## Constraints
- Frontend only: `views/Sidebar`, `RepositoryList`, their CSS modules, `AppShell` (`aria-label` of the nav), `App.tsx` wiring. Layering `views -> state -> api` and CSS-variable tokens only; no external fonts or CDNs.
- Icons are inline SVG/unicode-free components in the repo, no icon library dependency (builder's call; keep them small and `aria-hidden`).
- Nav structure is data-driven: a list of groups, each with items `{id, label, icon, visible, count}`.
- Update existing Sidebar unit tests and any Playwright specs that click the old "Show" items; add a test for hidden groups and for the filter shown only on Tasks.

## Left to the builder
Exact icons, spacing, badge styling, and the sub-list's visual detail, within the mockup in `assets/10-mockup.png` (final labels).

## As built (task 10)
- Built as specified, with the final result in `assets/10-result.png`; plan: `docs/superpowers/plans/10.md`.
- Leaving Tasks resets the repository filter to All: the existing routes (`#/backlog`, `#/workflows`) never carried it, and routes were out of scope. Remembering it would be a routing change, a separate task.
- A view whose area is off (stale `#/backlog` link, or the backlog still loading) marks Tasks as current and shows its repository list, as the app shows Tasks in that case.
- Known gaps: some new CSS uses raw `rgba(255,255,255,..)` instead of theme variables (as the old sidebar did); no test for a very large count badge.
