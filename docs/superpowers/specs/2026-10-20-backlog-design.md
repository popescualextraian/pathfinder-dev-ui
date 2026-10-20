# Backlog component: design

Date: 2026-10-20. Status: draft for approval.

## Intent

A team at Mercedes will run Pathfinder locally, one instance per project, and needs a shared backlog to pick work from. The shared place is GitLab (project `moldovaa/vans-factory-rotation` for testing). Pathfinder gets a new component, `backlog`, a sibling of `engine`, that shows the project's items on a board of lanes (columns) and lets the team move them between lanes.

The backlog is a generic layer over pluggable sources. GitLab is the first connector. A database or Jira could follow without changing the board, the API or the lane model.

Moving a card is the future trigger for the workflow component (not part of this design): Plan starts a planning phase, In progress starts implementation, and so on. This design only produces the trigger events.

## Goals

- A `backlog` package under `backend/src/backlog`, with its own boundary like `engine`.
- A connector interface that is small and stable, and a GitLab connector behind it.
- Lanes defined per project in a YAML file, with per-connector mapping and a trigger name per lane.
- A board view in the frontend, a REST API under `/api/backlog`, and live updates to the board.
- Move a card between lanes from the board; the move is written to the source.
- Link files to an item (repo, path, ref), stored in the source.
- Create and edit items from Pathfinder (second milestone, see Delivery).
- Emit a trigger event when a card is moved on the board.

## Non-goals

- The workflow component, phases, skills and anything that reacts to trigger events. Events are emitted and nothing listens yet.
- Triggers for changes that arrive by sync (a card moved in GitLab). Only moves made on the Pathfinder board emit events.
- Cost and type tags from the mock-up. GitLab has no source for cost; it would come from engine task data later.
- Jira, database or other connectors. The interface must allow them, none is built.
- Authentication or users inside Pathfinder. The engine has none either; the source token identifies the actor.
- Storing file contents. Links are pointers.
- GitLab's own board lists. Pathfinder's board is the board.

## Anti-goals

- Lane names ("Plan", "Test") appear in code. They must come from config only.
- GitLab concepts (labels, iid, `opened`) leak above the connector.
- Tokens appear in API responses, logs, YAML or the browser.
- A sync that silently overwrites someone's change in the source.

## Architecture

Same layering as the rest of the backend, one Nest module per layer:

- `backend/src/backlog/` is its own package: `service/`, `integration/`, `repository/` inside, plus an `index.ts` public surface. It imports nothing from the backend except `commons/`. The rest of the backend (`api/backlog`) imports it only through `backlog/index.ts`. `backend/test/unit/backlog/backlog-boundary.spec.ts` enforces both, as for the engine.
- `backlog/service/` owns the interfaces and tokens: `BacklogConnector` / `BACKLOG_CONNECTOR`, the lane config types, the item model, the event type. It imports no integration class; only `BacklogServiceModule` imports the integration module to wire the implementation.
- `backlog/integration/` holds `GitlabConnector` and a `connector.factory.ts` that selects the connector by name from config.
- `backlog/repository/` stores the local cache and the file links' cache (see Sync). Storage only.
- `api/backlog/` has the controller and DTOs. It maps HTTP and nothing else.
- Frontend: `api/backlog-api.ts` (and an SSE stream), `state/useBacklog`, `views/` (Board, Lane, ItemCard, ItemDialog, FileLinks), wired in `App.tsx`. The same `views` to `state` to `api` rule applies.

### Lane config (YAML, per project)

Path from `BACKLOG_CONFIG`. One file per Pathfinder instance, which is one project. Example:

```yaml
connector: gitlab
gitlab:
  baseUrl: https://gitlab.zt.msg.team
  project: moldovaa/vans-factory-rotation
  tokenEnv: GITLAB_TOKEN        # name of the env var; the value is never in the file
pollSeconds: 60
lanes:
  - id: todo
    title: Todo
    default: true               # items matching no lane land here
    gitlab: { label: "status::todo" }
  - id: plan
    title: Plan
    trigger: plan.enter
    gitlab: { label: "status::plan" }
  - id: in-progress
    title: In progress
    trigger: implement.enter
    gitlab: { label: "status::in-progress" }
  - id: test
    title: Test
    trigger: test.enter
    gitlab: { label: "status::test" }
  - id: review
    title: Review
    gitlab: { label: "status::review" }
  - id: done
    title: Done
    gitlab: { state: closed }
```

Rules: lane ids are unique and ordered by position; exactly one lane is `default`; the `gitlab` mapping is the only part the connector reads, so another connector adds its own key. `trigger` is an opaque name the workflow binds to later. Validation at startup names the bad key and never prints values, like `engine-config.ts`. The five default lanes are shipped as the example config.

### Item model

The connector-independent item: `id` (connector-scoped, string), `title`, `description`, `lane` (a lane id), `assignees` (name list), `url` (link to the source), `fileLinks`, `updatedAt`. Anything else GitLab offers stays inside the connector.

### Connector interface

Small and source-agnostic. Methods (names indicative):

- `list(): Item[]` returns all items with their lane resolved from config.
- `get(id)`.
- `moveToLane(id, laneId)` writes the lane to the source and returns the updated item.
- `create(draft)` and `update(id, patch)` (second milestone).
- `getFileLinks(id)` and `setFileLinks(id, links)`.

The connector resolves lanes. For GitLab: an issue's lane is the lane whose label it carries, else `done` if closed, else the default lane. Moving to a lane replaces the issue's `status::` label (leaving other labels alone) and closes or reopens the issue when moving to or from a lane mapped to `state: closed`. Missing lane labels are created on first sync. Errors map to a `BacklogError` family (not found, conflict, unreachable) that the API filter turns into 404, 409 and 503, like `bridge-error.filter.ts`.

### Sync and trigger events

GitLab stays the source of truth. The backend keeps a local cache of the items (one JSON file per project in `BACKLOG_DATA_DIR`, mode 600, as the engine does for tasks) and polls on `pollSeconds`, with a manual refresh endpoint. Webhooks are not possible because instances run on laptops.

A move writes through to the source first. If the source accepts it, the cache is updated, a `lane-changed` event goes out to the board over SSE, and the trigger event is emitted. If the source rejects it (for example the item changed lane there in the meantime), the move fails with 409 and the board reloads that item. Poll updates change the cache and push `item-updated` to the board, and never emit a trigger event.

Trigger event: `{ itemId, from, to, trigger, at }`, delivered to in-process listeners through an injectable emitter that `backlog/index.ts` exports. Nothing subscribes in this design.

### File links

A link is `{ repo, path, ref?, note? }`, a pointer into git. They are stored in GitLab as one comment per issue that Pathfinder owns and updates in place, found by a marker. The comment has a human-readable list of links and a machine-readable block in an HTML comment that the connector parses back into links on sync. Other comments are never touched. If the owned comment is deleted, the links are lost until set again; that is accepted. Other connectors store links in their own way behind the same two methods.

### API (under `/api/backlog`)

- `GET /lanes`: the lane config (ids, titles, order; never mappings or tokens).
- `GET /items`, `GET /items/:id`.
- `POST /items/:id/move` with `{ from, to }` (409 if the source's lane is not `from`).
- `PUT /items/:id/file-links` with the full list.
- `POST /refresh`.
- `GET /stream`: SSE of `lane-changed` and `item-updated`.
- `POST /items`, `PATCH /items/:id` (second milestone).

### Frontend

A board with one column per lane, count badge in each header, cards with number, title and assignee, and an "assigned to me" style filter on the assignee (assignment is a filter, not a lane). Drag and drop moves a card, with a visible error on a rejected move. Card detail shows the description, the source link and the file links, which can be edited. Styling uses the existing design tokens only. The mock-up's cost and type badges are out of scope.

## Constraints

- Node 22, NestJS and React as now; no new framework. A YAML parser dependency is needed (my call: `yaml`).
- Config validated at startup; bad values name the variable or key and never print values.
- Tokens only via the environment, never in YAML, API responses, logs or the cache file.
- The GitLab token needs the `api` scope (moves and comments). A project access token is recommended.
- Tests mirror the source tree, with a fake connector for unit and e2e tests. A GitLab connector contract test runs against a fake HTTP server; a live test against the test project is optional and skipped without `GITLAB_TOKEN`.

## Decisions taken with the user

- Backlog is a component next to the engine, generic, connector-based, GitLab first.
- Lanes are generic and configured per project in YAML; defaults Todo, Plan, In progress, Test, Review, Done. Test (AI, autonomous) and Review (human) are separate lanes (a recommendation the user accepted by default).
- Assignment is a filter, not a lane.
- GitLab is the source of truth; local polling; move writes through.
- Triggers fire only for moves made on the board, for now.
- File links are pointers, stored as a comment in GitLab.
- Create and edit in Pathfinder are in scope, staged as a second milestone.

## Delivery

1. Board: backlog package, lane config, GitLab connector (list, move, file links), cache and polling, API, SSE, board UI with drag and drop, trigger events emitted.
2. Create and edit: connector `create` and `update`, API and UI forms.

## Left to the builder

- Exact module, file and DTO names; exact SSE payload shape.
- Pagination and rate handling in the GitLab client.
- Drag and drop implementation (library or native).
- Format of the owned comment, so long as it has a marker and a parseable block.
- Cache file layout and how a changed lane config is applied to a cache that was written under the old one.

## Behaviour details (settled after the builder check; all my calls unless marked)

- **Item id and number:** `id` is the GitLab `iid` as a string; the card shows `#<id>`. Other connectors supply their own id and may add a display ref.
- **Lane resolution (GitLab):** closed issue means `done`, whatever labels it carries. Otherwise the issue's lane is the configured lane whose label it carries; with several, the lane that comes last in the config order wins; with none, the default lane. Labels outside the config are ignored, and `status::` is only a convention in the example config, never assumed by the connector.
- **Move (GitLab):** the move request carries the lane the client saw (`from`). The connector re-reads the issue and, if its current lane differs from `from`, fails with 409 and the board reloads that item. Otherwise it removes only the configured lane labels, adds the target lane's label, and closes or reopens when moving to or from `done`. Moving to `done` closes and leaves no lane label. The trigger event's `from` is therefore always the source's lane at the moment of the move.
- **Which items:** all open issues, plus closed issues updated in the last `doneDays` days (default 14, in config) for the Done lane. Older closed issues are not shown. The client paginates.
- **Order inside a lane (decided by the user):** no manual order in v1; newest `updatedAt` first. Cards move between lanes only.
- **File links:** last write wins; the `PUT` replaces the list. `repo` is a project path (for example `group/project`) or URL, with no validation that the path exists.
- **"Assigned to me":** the user of the token (one `GET /user` at startup, exposed as `me` in `GET /lanes`), since each person runs their own instance with their own token. The filter can also pick another assignee.
- **Lane config changes:** read at startup; a restart applies them. The cache is rebuilt from the source after a restart.
- **Optional component:** if `BACKLOG_CONFIG` is unset the app runs as today, with no backlog routes and no board. New variables go into README, `.env.example`, compose and `start:local`.

## Calls I made (not discussed)

- The `yaml` package for config; `BACKLOG_CONFIG` and `BACKLOG_DATA_DIR` as variable names.
- Poll default 60 seconds; the `done` lane maps to a closed issue and carries no label.
- Items with no `status::` label land in the default lane.
- A rejected move gives 409 and a board reload rather than a forced overwrite.
- The test project's labels and `TEST backlog:` issues (#2 to #5) are created; the issues are deleted when the work ends.
