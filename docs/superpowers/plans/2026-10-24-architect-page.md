# Architect Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Architect page (sidebar, Team group) that draws a project's architecture model, its last full review and its plan reviews, read from the project's git repository, plus the backend area `architecture` and the git integration behind it.

**Architecture:** New backend area `architecture` in the UI's own layers: `api/architecture` → `service/architecture` (validator, `ArchitectureService`, owns `RepositoryFiles`) → `integration/architecture` (`GitRepositoryFiles`: bare partial clone per configured repository, `git fetch` at most once a minute, `ls-tree`/`cat-file`, no checkout). Frontend: `api/architecture-api.ts` → `state/use-architecture*` → views that draw whatever `model.json` says (parts → modules × layers). Optional like the backlog: on only when `ARCHITECTURE_ENABLED=1`.

**Tech Stack:** NestJS 11, Jest + supertest, React 19 + Testing Library, Playwright, git 2.43 (child process, argument arrays only).

**Spec:** Section 5 (and 4.7, the contract files) of the task text, summarised in "Contract" below. CLAUDE.md rules (layering, boundary tests, README/CLAUDE.md updates) apply.

## Global Constraints

- Layering `api` → `service` → `integration`/`repository` → `commons`; the service owns `RepositoryFiles` and the token `REPOSITORY_FILES`; only the integration runs git; one Nest module per layer (`ArchitectureApiModule`, `ArchitectureServiceModule`, `ArchitectureIntegrationModule`). Cross-cutting concerns stay in global pipes/filters; domain errors get a filter in `api/architecture` like `schedule-error.filter.ts`.
- Frontend layering `views` → `state` → `api`; only `frontend/src/api` calls the backend. Design tokens from `theme.css`, one CSS module per view, no external fonts/CDNs.
- **Nothing about a project is hardcoded in the page.** Parts, modules, layers, components come from `model.json`; both fixture model (two parts, two modules) and a one-part, no-module model must render; test both.
- Security: the token (`GH_TOKEN`/`GIT_TOKEN`) never appears in a log, URL, file or response; git gets it only through `gitCredentialEnv` (variable reference, never the value); git runs with argument arrays only (no shell); branch names and slugs are validated before use; the clone folder is mode 700; URLs shown to users carry no userinfo.
- Tests use made-up tokens and bare repositories made from local paths in the test; never the network, never Docker.
- Fixtures are the contract and are copied **unchanged** (JSON text exactly as given in the task) to `backend/test/fixtures/architecture/`.
- Where the mockups and section 5 differ, section 5 wins. No Focus button, no Expand, no arrows (selecting a component lights up its connections).
- Colours: green new, amber changed, red removed; every mark also has its sign `+ ~ −`.
- Commit after each task, tests run before each commit. No push. Do not touch deployment or `~/.config/pathfinder-ui/`.

## Contract (files read from the repository, all `"version": 1`)

Paths under `docs/architecture/`: `model.json`, `reviews/full.json`, `reviews/plans/<slug>.json`. A reader refuses another version with `"<file>: version 2 is not supported (this UI reads version 1)"`. Component ids `[a-z0-9-]{1,60}`. Shapes (TypeScript, in `backend/src/service/architecture/architecture-types.ts`, mirrored in `frontend/src/api/models.ts`):

```ts
type Via = 'call' | 'rest' | 'event' | 'file' | 'other';
interface Model { version: 1; style: {id: string; name: string};
  parts: { id; name; layers: {id; name; mayUse: string[]}[]; modules: {id; name}[] }[];   // layers top to bottom; modules [] = one column
  components: { id; name; part; layer; module: string|null; parent: string|null; summary; page }[];
  connections: { from; to; via: Via }[] }
interface FullReview { version: 1; kind: 'full'; commit; reviewedAt; components: Record<string,{reviewedAt: string}>;
  findings: { id; rule; component; severity: 'error'|'warn'|'info'; source: 'depcruise'|'llm'|'jscpd'|'knip'; text; status: 'open'|'fixed'|'accepted'; since?: string }[] }
interface PlanReview { version: 1; kind: 'plan'; title; plan; baseCommit; reviewedAt; size: 'S'|'M'|'L'; summary;
  changes: { component; change: 'new'|'changed'|'removed'; line;
             proposed?: { name; part; layer; module: string|null; summary; talks_to: {to: string; via: Via}[] } }[];
  findings: { id; rule; component; severity; text; alternative?: string; status: 'open'|'fixed'|'accepted' }[];
  passed: string[] }
```

## Review Focus

- A branch name with `/` (`agentic/T-…`, `feature/…`) in the URL: encoded as one segment; decodes to the branch; a malicious one (`--upload-pack=x`, `..`, leading `-`) is 400 and never reaches git.
- A branch forked from main inherits main's plan reviews: they are listed once (for the branch that adds or changes them), not once per branch.
- One broken review file or branch without `model.json` must not hide the other reviews (listed under `refused`).
- A clone/fetch failure (remote unreachable) with an existing clone serves stale data; without a clone → 502; no secret in the message.
- A repository without `docs/architecture/model.json`: 404 and the page's empty state (how to run `/architect seed`).
- `full.json` invalid: the picture still shows (`fullReviewError`), a finding for an unknown component id does not break the page.
- Model with a component whose module is `null` in a part that has modules (spans the row), module of a part without modules, a layer with no components, a proposed new component in a layer/module cell that has no other components.

---

### Task 1: Fixtures and the shared repository helper

**Files:**
- Create: `backend/test/fixtures/architecture/{model.json,full.json,2026-10-20-gift-cards.json,2026-10-22-move-catalog.json,one-part-model.json}` and `backend/test/fixtures/architecture/invalid/{plan-unknown-component.json,model-version-2.json}` (first four and the invalid two: the task's appendix JSON verbatim; `one-part-model.json`: own, a plain layered app, one part `app` with layers `ui`/`logic`/`data`, `modules: []`, 4 components, 3 connections, style `layered`)
- Create: `backend/test/helpers/architecture-repo.ts`
- Test: `backend/test/unit/helpers/architecture-repo.spec.ts` (jest `backend` project picks `backend/test/unit/**/*.spec.ts`; check jest.config.js)

**Interfaces:**
- Produces (used by Tasks 4, 5, 6, 9; must be synchronous so `playwright.config.ts` can call it):
```ts
export const FIXTURE_DIR: string;                 // absolute path of backend/test/fixtures/architecture
export interface FixtureRepo { path: string /* the bare repo */; root: string /* temp dir holding it */; commit(branch: string, files: Record<string,string|null>, message?: string): string /* sha; null deletes; branch created from main if missing */; cleanup(): void }
export function makeFixtureRepo(options?: { root?: string; name?: string; model?: 'fixture' | 'one-part'; extraBranches?: boolean }): FixtureRepo;
```
  `makeFixtureRepo()` builds (with `execFileSync('git', [...args])`, a throw-away worktree, identity set by `-c user.name=… -c user.email=…`) a bare repo `<root>/<name>.git` (default name `acme-shop`): `main` = `docs/architecture/model.json` (fixture or one-part model) + `reviews/full.json` (only for `'fixture'`); with `extraBranches` (default true for `'fixture'`): `feature/gift-cards` adds `…/reviews/plans/2026-10-20-gift-cards.json`, `agentic/T-20261024-ab12-move-catalog` adds `…/2026-10-22-move-catalog.json`. The bare repo has `uploadpack.allowFilter=true`, `uploadpack.allowAnySHA1InWant=true`. `commit` pushes into the bare repo after committing in the worktree. `root` defaults to a new `mkdtemp`; with `options.root` the folder is created if missing and `cleanup` removes only what it made.

- [ ] **Step 1: Write the failing test** `architecture-repo.spec.ts`: `git for-each-ref refs/heads` of the bare repo lists exactly `agentic/T-20261024-ab12-move-catalog`, `feature/gift-cards`, `main`; `git show main:docs/architecture/model.json` equals the fixture file byte for byte; `feature/gift-cards` has the gift-cards plan and `main` does not; `commit('main', {'x.txt': 'a'})` adds a file, `commit('main', {'x.txt': null})` removes it; `makeFixtureRepo({model:'one-part', extraBranches:false})` has only `main`; `cleanup()` removes the root.
- [ ] **Step 2: Run** `npx jest --selectProjects backend architecture-repo` → FAIL (module missing).
- [ ] **Step 3: Add the fixture files verbatim, implement the helper.**
- [ ] **Step 4: Run it** → PASS. Also `npm run lint`.
- [ ] **Step 5: Commit** `Architect: shared fixture set and repository helper`.

---

### Task 2: Commons: credential helper moved, architecture config

**Files:**
- Move: `backend/src/engine/integration/launcher/git-credential-env.ts` → `backend/src/commons/git-credential-env.ts` (update the two importers and the test `backend/test/unit/engine/integration/launcher/git-credential-env.spec.ts` → `backend/test/unit/commons/git-credential-env.spec.ts`; `docker-task-launcher.spec.ts` import)
- Create: `backend/src/commons/architecture-config.ts`, `backend/src/commons/architecture-config.module.ts`
- Test: `backend/test/unit/commons/architecture-config.spec.ts`

**Interfaces:**
- Produces:
```ts
export const ARCHITECTURE_CONFIG: unique symbol;
export interface ArchitectureConfig { dataDir: string; fetchSeconds: number }
export class ArchitectureConfigError extends Error { readonly problems: string[] }
export function architectureEnabled(env?: NodeJS.ProcessEnv): boolean;         // ARCHITECTURE_ENABLED === '1' (trimmed)
export function loadArchitectureConfig(env?: NodeJS.ProcessEnv): ArchitectureConfig;
@Module ArchitectureConfigModule  // provides/exports ARCHITECTURE_CONFIG via useFactory(() => loadArchitectureConfig())
```
  `ARCHITECTURE_DATA_DIR`: absolute; default `join(dirname(ENGINE_DATA_DIR), 'architecture')` (as `schedule-config.ts`; error when neither is set). `ARCHITECTURE_FETCH_SECONDS`: positive integer, default 60, at most 3600. Messages name variables, never values. `ARCHITECTURE_ENABLED` other than unset/`0`/`1` → a problem naming the variable.

- [ ] **Step 1: Failing tests** for config (default dir beside ENGINE_DATA_DIR; explicit relative dir refused naming `ARCHITECTURE_DATA_DIR`; `ARCHITECTURE_FETCH_SECONDS=0`, `abc`, `3601` refused; default 60; `architectureEnabled` true only for `1`) and the moved credential spec at its new path.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Move the file with `git mv`, fix imports, implement config + module** (style of `schedule-config.ts`).
- [ ] **Step 4: Run** `npx jest --selectProjects backend commons engine` and `npm run lint` → PASS (engine boundary spec still passes: engine imports only commons).
- [ ] **Step 5: Commit** `Architect: move git credential helper to commons, add architecture config`.

---

### Task 3: Service types, names and the validator

**Files:**
- Create: `backend/src/service/architecture/architecture-types.ts` (the Contract types plus the result types of Task 5), `architecture-names.ts`, `architecture-validator.ts`
- Test: `backend/test/unit/service/architecture/architecture-validator.spec.ts`, `architecture-names.spec.ts`

**Interfaces:**
- Produces:
```ts
// architecture-names.ts
export const MODEL_FILE = 'docs/architecture/model.json'; FULL_REVIEW_FILE = 'docs/architecture/reviews/full.json'; PLANS_DIR = 'docs/architecture/reviews/plans';
export function isValidBranchName(name: string): boolean;   // ^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$, no "..", no "//", no trailing "/", ".", or ".lock", no "/." segment start
export function isValidSlug(slug: string): boolean;         // ^[a-z0-9][a-z0-9._-]{0,99}$, no ".."
export function planFile(slug: string): string;             // `${PLANS_DIR}/${slug}.json`
// architecture-validator.ts   (hand-written, no library; each throws ArchitectureFileError(file, "<json path>: <message>") with the FIRST problem)
export class ArchitectureFileError extends Error { constructor(readonly file: string, readonly detail: string) /* message = `${file}: ${detail}` */ }
export function parseModel(file: string, text: string): Model;
export function parseFullReview(file: string, text: string): FullReview;                 // shape only; unknown component ids allowed
export function parsePlanReview(file: string, text: string, model: Model): PlanReview;   // every changes[].component is in the model, or change==='new' with `proposed` whose part/layer/module exist in the model; findings[].component in the model or a `new` change id
```
  Rules: invalid JSON → "is not valid JSON"; `version` missing/not 1 → `version N is not supported (this UI reads version 1)` (for non-number: `version must be 1`); `kind` must match; `parseModel` also checks ids match the id pattern and are unique (parts, layers per part, modules per part, components), `components[i].part/layer/module` exist (module `null` allowed), `parent` null or an existing component, `connections` endpoints exist, `via` allowed, `mayUse` entries are layers of the same part, `style.name` non-empty; enums for severity/status/source/size/change.

- [ ] **Step 1: Failing tests**: all four fixture files pass; `invalid/model-version-2.json` throws with message containing `version 2 is not supported`; `invalid/plan-unknown-component.json` against the fixture model throws naming `changes[0].component` and `invoice-service`; one test per rule above (unknown layer in a component, duplicate component id, connection to unknown id, bad `via`, `new` change without `proposed`, proposed with unknown layer, bad size, not JSON, a 5-part list ok); one-part model passes; `isValidBranchName` accepts `main`, `feature/gift-cards`, `agentic/T-20261024-ab12-move-catalog`, refuses `--upload-pack=x`, `-x`, `a..b`, `a//b`, `/a`, `a/`, `x.lock`, `a b`, `a;b`, `a\nb`, 201 chars; `isValidSlug` accepts `2026-10-20-gift-cards`, refuses `../x`, `A`, `a/b`, `.x`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** with lint → PASS.
- [ ] **Step 5: Commit** `Architect: model and review validator, name rules`.

---

### Task 4: GitRepositoryFiles (integration) and the `RepositoryFiles` interface

**Files:**
- Create: `backend/src/service/architecture/repository-files.ts` (interface, token, errors), `backend/src/integration/architecture/git-repository-files.ts`, `backend/src/integration/architecture/git-runner.ts` (spawn wrapper, redaction), `backend/src/integration/architecture/architecture-integration.module.ts`
- Test: `backend/test/unit/integration/architecture/git-repository-files.spec.ts`, `git-runner.spec.ts` (uses `makeFixtureRepo`)

**Interfaces:**
- Produces:
```ts
// service/architecture/repository-files.ts
export const REPOSITORY_FILES = Symbol('REPOSITORY_FILES');
export interface RepositoryFiles {
  head(repository: string): Promise<{ branch: string; sha: string }>;            // the remote's default branch
  branches(repository: string): Promise<{ name: string; sha: string }[]>;        // all heads, sorted by name
  list(repository: string, branch: string, dir: string): Promise<{ path: string; id: string }[]>;  // files below dir (recursive), [] if none; id = blob id
  read(repository: string, branch: string, path: string, maxBytes: number): Promise<string | null>; // null: no such file
}
export class RepositoryUnavailableError extends Error {}   // clone/fetch failed and there is no clone; message has no secrets
export class RepositoryFileTooLargeError extends Error { constructor(readonly path: string, readonly maxBytes: number) }
export class RepositoryUnknownError extends Error {}
// integration
export class GitRepositoryFiles implements RepositoryFiles { constructor(config: { dataDir: string; fetchSeconds: number; repositories: {name: string; url: string}[]; env?: NodeJS.ProcessEnv; now?: () => number }) }
@Module ArchitectureIntegrationModule  // imports EngineConfigModule + ArchitectureConfigModule; provides REPOSITORY_FILES via factory(ENGINE_CONFIG, ARCHITECTURE_CONFIG); exports REPOSITORY_FILES
```
- Behaviour: first use of a repository: `dataDir` created `0o700` (chmod too), `git clone --bare --filter=blob:none --no-tags -- <url without userinfo> <dataDir>/<name>.git`, then `remote.origin.fetch=+refs/heads/*:refs/heads/*`; later calls `git fetch --prune --update-head-ok origin` at most once per `fetchSeconds` (injected `now`), then `git ls-remote --symref origin HEAD` (failure ignored) → `git symbolic-ref HEAD refs/heads/<default>`; fetch failure with an existing clone → serve stale (log a warning with redacted text via Nest `Logger`), without clone → `RepositoryUnavailableError("could not read repository <name>")`; one promise chain per repository (no parallel clone/fetch). `branches`: `git for-each-ref --format=%(refname:strip=2) %(objectname) refs/heads/`. `list`: `git ls-tree -r -z <sha> -- <dir>` (use the branch's sha, branch checked with `isValidBranchName`, `dir` must be one of the fixed paths or start with `docs/architecture/`, no `..`). `read`: ls-tree entry for the path (none → null), `git cat-file -s <oid>` > maxBytes → `RepositoryFileTooLargeError`, else `git cat-file blob <oid>` decoded utf-8. Every git call: `execFile`-style with args array, env = `{PATH, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GH_TOKEN/GIT_TOKEN passed through if set, ...gitCredentialEnv(url)}`, 30 s timeout, `cwd` the clone. Error text goes through `redact()` (removes the values of GH_TOKEN/GIT_TOKEN and any `//user:pass@`). Repository name not configured → `RepositoryUnknownError`. Invalid branch → throws `Error('invalid branch name')` before spawning.

- [ ] **Step 1: Failing tests** (real git, bare fixture repo as the remote, `fetchSeconds` tiny/`now` injected): `head` → `main` + its sha; `branches` lists the three; `list(…,'feature/gift-cards','docs/architecture/reviews/plans')` returns the gift-cards file with a 40-hex id, and `[]` for `main`; `read` model returns the fixture text, a missing file → null, `maxBytes: 10` → `RepositoryFileTooLargeError`; **fetch**: after `fixture.commit('main', {...})` a read within `fetchSeconds` still sees the old state, after advancing `now` past it sees the new one; **prune**: deleting a branch in the remote disappears after the next fetch; **stale**: remove the remote repo after the clone exists → reads still work (warning logged), a fresh instance with an empty data dir → `RepositoryUnavailableError` whose message does not contain the path of the remote, the token, or `GH_TOKEN`'s value; **security**: an invalid branch (`--upload-pack=touch /tmp/x`, `-x`, `a..b`) rejects and no git process starts (spy on `git-runner`); the clone folder mode is 700; the clone's `config` file contains no token (set `GH_TOKEN=ghp_made-up-token`, remote URL `https://user:pw@example.invalid/a/b.git` is rejected earlier... use a local path remote for real runs and a unit test of the URL sanitiser for userinfo); `git-runner` redacts a token and `//u:p@` from an error; a `file://` URL remote works with the partial clone (lazy blob fetch) — one test; concurrent `head()` calls clone once.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx jest --selectProjects backend git-repository-files git-runner` + lint → PASS.
- [ ] **Step 5: Commit** `Architect: git integration reading files from a bare partial clone`.

---

### Task 5: ArchitectureService and its module

**Files:**
- Create: `backend/src/service/architecture/architecture.service.ts`, `architecture-errors.ts`, `page-url.ts`, `architecture-service.module.ts`
- Test: `backend/test/unit/service/architecture/architecture.service.spec.ts`, `page-url.spec.ts`; test helper `backend/test/helpers/fake-repository-files.ts` (in-memory `RepositoryFiles` built from `{ [repository]: { default: string; branches: { [branch]: { sha: string; files: Record<string,string> } } } }`, or built from a `FixtureRepo` by reading it with real git is NOT needed here)

**Interfaces:**
- Consumes: Task 3 (`parseModel`, `parseFullReview`, `parsePlanReview`, names), Task 4 `RepositoryFiles`, `RepositoriesService` from `service/repositories` (list of `{name,url,default}`).
- Produces:
```ts
export class ArchitectureNotFoundError extends Error {}      // unknown repository, no model.json, unknown review
export class ArchitectureBadRequestError extends Error {}    // invalid branch or slug
// ArchitectureFileError (Task 3) is the 422
export interface CurrentArchitecture { repository: string; branch: string; sha: string; model: Model; fullReview: FullReview | null; fullReviewError: string | null; pageBase: string | null }
export interface ReviewSummary { branch: string; slug: string; sha: string; title: string; plan: string; reviewedAt: string; size: 'S'|'M'|'L'; summary: string; touched: { component: string; change: 'new'|'changed'|'removed' }[]; openFindings: number; findings: number }
export interface RefusedReview { branch: string; slug: string | null; file: string; error: string }
export interface ReviewList { repository: string; branch: string; sha: string; reviews: ReviewSummary[]; refused: RefusedReview[] }
export interface ReviewDetail { repository: string; branch: string; sha: string; slug: string; model: Model; review: PlanReview; pageBase: string | null }
@Injectable() class ArchitectureService {
  status(): { repositories: string[] };
  current(repository?: string): Promise<CurrentArchitecture>;
  reviews(repository?: string): Promise<ReviewList>;
  review(repository: string | undefined, branch: string, slug: string): Promise<ReviewDetail>;
}
export function pageBase(repoUrl: string, branch: string): string | null;   // page-url.ts
@Module ArchitectureServiceModule.register({ imports: [Module] }) // same dynamic-module pattern as ScheduleServiceModule.register or simply imports [RepositoriesServiceModule, ArchitectureIntegrationModule]; wiring the integration is this module's job (like the others)
```
- Behaviour: `repository` omitted → the default repository; unknown → `ArchitectureNotFoundError`. `current`: `head`, read `MODEL_FILE` (1 MB cap; null → NotFound "no docs/architecture/model.json on <branch>"), parse; read full review: null → `fullReview: null`; parse failure → `fullReviewError` = the error message, `fullReview: null`; too large is an error message too. `reviews`: branches (cap 100, default first), for each `list(PLANS_DIR)` keeping only `*.json` directly below; an entry is skipped when the default branch holds the same path with the same `id` (inherited), unless the branch is the default; then per review read the file + that branch's `model.json`, validate; any failure goes to `refused` (the branch without a model: error `no docs/architecture/model.json on <branch>`); reviews sorted by `reviewedAt` descending. `review(branch, slug)`: names validated (400), the file must exist on that branch (404), model from the same branch, validation failure = `ArchitectureFileError` (422). `pageBase`: only for `http`/`https` URLs, userinfo and `.git` removed, `github.com` → `https://github.com/o/r/blob/<branch>/docs/architecture/`, any other host → `https://host/o/r/-/blob/<branch>/docs/architecture/` (branch URL-encoded per segment); local paths and SSH urls (`git@host:o/r.git`) → also convert scp-style to https; unparsable → null.

- [ ] **Step 1: Failing tests** with the fake `RepositoryFiles` and the fixture JSON: current returns model + full review + `pageBase` for `https://github.com/acme/default.git`; no model → NotFound; invalid `full.json` → picture + `fullReviewError` naming the file; invalid model → `ArchitectureFileError` naming `docs/architecture/model.json`; reviews: with branches main/feature/gift-cards/agentic/…-move-catalog → 2 reviews, newest `reviewedAt` first, `touched` and `openFindings` right (gift-cards: 4 touched, 1 open; move-catalog: 3, 0); inherited review (same path+id on main) listed once, for the branch that adds it only; a branch whose only plan is `invalid/plan-unknown-component.json` content lands in `refused` with the first error and the others still list; a branch without model in `refused`; `review()` detail has that branch's model (use a branch whose model differs); bad branch `--x` and slug `../x` → BadRequest without calling `files`; unknown slug → NotFound; `pageBase` cases (github, gitlab, userinfo stripped, scp-style, local path → null).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** + lint → PASS.
- [ ] **Step 5: Commit** `Architect: ArchitectureService reads the model and reviews from the repository`.

---

### Task 6: REST API, wiring, e2e

**Files:**
- Create: `backend/src/api/architecture/{architecture.controller.ts,architecture-error.filter.ts,architecture-api.module.ts}`
- Modify: `backend/src/app.module.ts` (`architectureModules(env)` like `backlogModules`, spread into imports), `backend/src/main.ts` (call `loadArchitectureConfig()` when enabled, catch `ArchitectureConfigError`), `tools/local-env.cjs` + its unit test (`ARCHITECTURE_DATA_DIR` defaults to `<data>/architecture`, made absolute; `ARCHITECTURE_ENABLED`/`ARCHITECTURE_FETCH_SECONDS` pass through), `backend/test/e2e/create-app.ts` (option `architecture?: { repositories: {name,url}[]; fetchSeconds?: number }`: sets `ARCHITECTURE_ENABLED=1`, `ARCHITECTURE_DATA_DIR` under the data dir, `ENGINE_REPOS`; adds `ArchitectureApiModule`; unset again on close), `backend/test/unit/app.module.spec.ts` (module list on/off)
- Test: `backend/test/e2e/architecture.e2e-spec.ts` (real `GitRepositoryFiles` against `makeFixtureRepo` repos; token `FAKE_GH_TOKEN` is set in the env), `backend/test/unit/api/architecture/*.spec.ts` for the filter

**Interfaces:**
- Consumes: Task 5 `ArchitectureService`; Task 4 module.
- Produces routes under `/api/architecture` (declared in this order): `GET /status` → `{ repositories: string[] }`; `GET /` (`?repository=`) → `CurrentArchitecture`; `GET /reviews` (`?repository=`) → `ReviewList`; `GET /reviews/:branch/:slug` (`:branch` is URL-encoded, one segment) → `ReviewDetail`. Errors: `ArchitectureNotFoundError` 404, `ArchitectureBadRequestError` 400, `ArchitectureFileError` 422 with `{statusCode, message, file, path}`, `RepositoryUnavailableError` 502, `RepositoryFileTooLargeError` 422 — filter `ArchitectureErrorFilter` on the controller. `repository` query validated with the same name pattern as tasks (see `commons/repo-name`/`task-input-rules`); no DTO class needed if the filter/service already validate, otherwise a plain check.

- [ ] **Step 1: Failing e2e**: feature off → `GET /api/architecture/status` 404; on, repositories `acme-shop` (fixture) and `plain` (`model:'one-part'`): status lists both; `GET /api/architecture?repository=acme-shop` → 200 with `model.parts` of length 2, `fullReview.findings` length 3, `branch: 'main'`, 40-hex `sha`, `pageBase` null (local path remote); `plain` → `fullReview: null`; a repository with no docs → 404; invalid `full.json` committed with `fixture.commit` (and `ARCHITECTURE_FETCH_SECONDS` small, or a second repo) → 200 + `fullReviewError`; `GET /reviews` → two reviews; `GET /reviews/feature%2Fgift-cards/2026-10-20-gift-cards` → 200 with `review.title` "Gift cards at checkout"; the agentic branch one likewise; `--upload-pack%3Dx/2026-10-20-gift-cards` → 400; `…/nope` → 404; unknown repository → 404; invalid plan on a branch → listed in `refused`, detail 422 naming the file; remote removed with no clone → 502; **no response body, and no file in the data dir, contains `FAKE_GH_TOKEN`**; the clone dir mode is 700.
- [ ] **Step 2: Run** `npm run test:e2e -- architecture` → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test`, `npm run test:e2e`, `npm run lint` → PASS.
- [ ] **Step 5: Commit** `Architect: REST API, app wiring, e2e over a fixture repository`.

---

### Task 7: Frontend api, models, state, route, sidebar

**Files:**
- Modify: `frontend/src/api/models.ts` (the Contract types plus the result types of Task 5, `ArchitectureStatus`), `frontend/src/state/use-route.ts` (`View` gains `'architect'`; `Route` gains `review?: { branch: string; slug: string }`; hash `#/architect[?repo=<name>]`, `#/architect/reviews/<encoded branch>/<slug>[?repo=<name>]`; `buildHash`/`parseHash`, `selectReview(review|null)`, `selectView` clears `review`; repository for this view travels in `route.repository` via `?repo=`), `frontend/src/views/Sidebar.tsx` (prop `architectEnabled`; group `Team` with entry `architect`, label "Architect", icon), `frontend/src/views/nav-icons.tsx` (icon `architect`: inline SVG, a building/columns)
- Create: `frontend/src/api/architecture-api.ts` (`getArchitectureStatus` → `ArchitectureStatus | null` (null on 404), `getArchitecture(repository?)`, `listReviews(repository?)`, `getReview(repository, branch, slug)` with `encodeURIComponent` per segment), `frontend/src/state/use-architecture.ts` (`useArchitectureStatus()` → `{enabled, repositories, loading}`; `useArchitecture(repository)` → `{loading, error, notFound, data}`; `useArchitectureReviews(repository)` → `{loading, error, list}`; `useReviewDetail(repository, branch, slug)`)
- Test: `frontend/test/api/architecture-api.test.ts`, `frontend/test/state/use-architecture.test.tsx`, `frontend/test/state/use-route.test.ts` (extend), `frontend/test/views/Sidebar.test.tsx` (extend: entry shown only when enabled, first entry of group Team, none when disabled and the Team group is then dropped)

**Interfaces:**
- Produces for Tasks 8-9: the hooks above; `Route.review`; `useRoute().selectReview(r)`.
- State hooks: errors as strings; `notFound` true on `ApiError.status === 404` of `getArchitecture`; a stale response of a previous repository never overwrites a newer one (request sequence guard, as `use-backlog`).

- [ ] **Step 1: Failing tests** (fetch mocked as the other api tests): URLs (`/api/architecture?repository=a%20b`, `/api/architecture/reviews/feature%2Fgift-cards/2026-10-20-gift-cards?repository=x`), 404 of status → `null`, route round trips (`#/architect`, `#/architect?repo=shop`, `#/architect/reviews/feature%2Fgift-cards/slug?repo=shop` ↔ `{view:'architect', repository:'shop', review:{branch:'feature/gift-cards', slug}}`, malformed escapes fall back to the plain view), hooks load/error/notFound/ignore stale, sidebar.
- [ ] **Step 2: Run** `npx jest --selectProjects frontend architecture use-route Sidebar` → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` + `npx tsc -p frontend --noEmit` (use the repo's frontend typecheck if different) → PASS.
- [ ] **Step 5: Commit** `Architect: frontend api, state, route and sidebar entry`.

---

### Task 8: The picture and its panels (views)

**Files:**
- Create in `frontend/src/views/`: `ArchitectureGrid.tsx` (+`.module.css`), `ComponentPanel.tsx`, `ReviewList.tsx`, `ImpactPanel.tsx`, `FullReviewPanel.tsx` (each with a CSS module), `architecture-layout.ts` (pure: `buildGrid(model, overlay?)`)
- Test: `frontend/test/views/architecture-layout.test.ts`, `ArchitectureGrid.test.tsx`, `ComponentPanel.test.tsx`, `ReviewList.test.tsx`, `ImpactPanel.test.tsx`, `FullReviewPanel.test.tsx`; fixtures: `frontend/test/fixtures/architecture.ts` loads the JSON files from `backend/test/fixtures/architecture/` (`fs.readFileSync` in the test; the fixture files are not duplicated)

**Interfaces:**
- Produces:
```ts
export interface GridImpact { [componentId: string]: 'new' | 'changed' | 'removed' }
export interface GridComponent { id; name; summary; part; layer; module: string|null; page: string; state: 'plain'|'new'|'changed'|'removed'|'dim' }   // `new` ones come from `proposed`
export interface GridBlock { part: {id;name}; columns: {id: string|null; name: string}[]  /* [{id:null,name:''}] when the part has no modules */;
  rows: { layer: {id;name}; cells: GridComponent[][]  /* one array per column */; spanning: GridComponent[] /* module === null */ }[] }
export function buildGrid(model: Model, changes?: PlanReview['changes']): GridBlock[];   // one block per part in model order; spanning components (module null) are drawn across the row, never in a column
// ArchitectureGrid props: { model: Model; changes?: PlanReview['changes']; findings?: {component: string; status: 'open'|'accepted'|'fixed'}[]; selectedId: string | null; onSelect: (id: string | null) => void }
// ComponentPanel props: { component: GridComponent | undefined; model: Model; change?: PlanReview['changes'][number]; findings: (FullReview['findings'][number] | PlanReview['findings'][number])[]; pageBase: string | null; onSelect: (id: string) => void }
// ReviewList props: { reviews: ReviewSummary[]; refused: RefusedReview[]; selected: {branch; slug} | null; knownTaskIds: string[]; onSelect(branch, slug); onOpenTask(taskId) }
// ImpactPanel props: { review: PlanReview; model: Model; selectedId: string | null; onSelect(id) }
// FullReviewPanel props: { review: FullReview | null; error: string | null; model: Model; onSelect(id) }
```
- Behaviour: headings and cells all derive from the model (no literal "Frontend", "API", "commons" in the view code; the only fixed words are UI chrome); a new proposed component shows in its module/layer cell, even when it is the only one; a block's cell with no components is an empty cell; a component with `module: null` in a part with modules spans the row (as in the mockup's commons strip); untouched components are `dim` only when a `changes` overlay exists; markers `+`/`~`/`−` as text, `aria-label` e.g. "new component"; removed name struck through; badges: open findings count, `✓` for accepted (aria-labels "2 open findings", "accepted exception"); clicking a chip calls `onSelect`; the selected component's connected components (`model.connections`, either direction) get class `linked`, others unchanged; `ReviewList` shows title, branch, the task id link only when the branch matches `^agentic/(T-\d{8}-[a-z0-9]{4,})` and that task id is in `knownTaskIds`, relative time (`reviewedAt`), components touched count, open findings; `refused` entries listed with their error; `ImpactPanel` lists changes with sign and component name (click selects, selected row highlighted), proposed components' `layer`/`module`, the rule check (findings with `text` + `alternative`, `passed` rules with a tick) and the size; the component panel shows summary, "Module · Layer · Part", talks to / used by from `connections` (names, clickable), its findings, "In this plan" line, and a page link `pageBase + page` when `pageBase` is given.
- Colours via tokens: add `--impact-new`, `--impact-changed`, `--impact-removed` (and soft backgrounds) to `theme.css`.

- [ ] **Step 1: Failing tests**: `buildGrid` for the fixture model → 2 blocks, each with columns Orders/Catalog, backend rows api…commons, `config`/`validation` spanning in `commons`; one-part model → one block, one column with `id:null`; gift-cards overlay → `gift-card-service` state `new` in backend/service/orders, `order-service` `changed`, the rest `dim`; move-catalog → `catalog-store` `removed`. Grid render for both models by role/text: block headings come from the model; chips with `+`/`~`/`−`; badges from findings (fixture full: `order-service` 1 open, `orders-api` accepted tick, `fixed` shows no badge); selecting `order-service` marks `orders-api`, `payment-gateway`, `order-store`, `catalog-service` linked. Panels per above; `ReviewList` task link appears for `agentic/T-20261024-ab12-move-catalog` only when `T-20261024-ab12` is known.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` + lint → PASS.
- [ ] **Step 5: Commit** `Architect: grid, component panel, review list and impact panel`.

---

### Task 9: ArchitectPage, App wiring, Playwright spec

**Files:**
- Create: `frontend/src/ArchitectPage.tsx` (+ `ArchitectPage.module.css`), `e2e/architecture.spec.ts`, `e2e/support/architecture-fixture.ts` (calls `makeFixtureRepo` from `backend/test/helpers/architecture-repo.ts`; builds once into `.local/architecture-fixture/` if missing; exports `architectureFixtureRepositories()` → `ENGINE_REPOS`-style JSON string and `ARCHITECTURE_*` values)
- Modify: `frontend/src/App.tsx` (status hook; `architectEnabled`; board slot for `view === 'architect'`), `playwright.config.ts` (webServer env `ARCHITECTURE_ENABLED: '1'`, `ARCHITECTURE_FETCH_SECONDS: '5'`, `ENGINE_REPOS` = the two fixture repositories `acme-shop` and `plain`, built by calling the support module at config load)
- Test: `frontend/test/ArchitectPage.test.tsx` (hooks mocked or `api/architecture-api` mocked), `e2e/architecture.spec.ts` (Playwright)

**Interfaces:**
- `ArchitectPage` props: `{ repositories: Repository[] /* the configured ones, ENGINE order */; repository: string | null; review: {branch; slug} | null; knownTaskIds: string[]; onSelectRepository(name); onSelectReview(r | null); onOpenTask(id) }`. Header: repository `<select>` (only the names the status endpoint lists), style pill (`model.style.name`), pill "doc on <branch> @ <sha7>"; tabs "Current architecture" and "Plan reviews (n)" (n from the list; tab chosen by `review` in the route: `review` set → reviews tab). Current tab: `ArchitectureGrid` (+ finding badges from the full review) beside `FullReviewPanel`; clicking a component opens `ComponentPanel`. Reviews tab: `ReviewList` left; with a selection the grid from that branch's model with overlay (`useReviewDetail`), `ComponentPanel` and `ImpactPanel`; without a selection a hint. Empty state when `notFound`: "No architecture doc on <branch/default> of <repo>. Run the architect skill in a task: `/architect seed`, then push the branch." Loading and error states; `fullReviewError` shown as a notice above the panel. Footer line "Source: docs/architecture/ … on <branch>".

- [ ] **Step 1: Failing tests.** Unit (jest): fixture data for both repositories: acme-shop shows both part headings (Frontend, Backend), style pill, both tabs with "Plan reviews (2)"; plain (one part, no modules) renders one block and no module headings; notFound shows the empty state with `/architect seed`; selecting a review calls `onSelectReview`; with a `review` route, overlay markers are shown; switching repository calls `onSelectRepository`. Playwright (`e2e/architecture.spec.ts`): sidebar has Architect under Team, click → `#/architect`; the picture of acme-shop (Frontend and Backend blocks, `+`-free), open badge on Order service, panel for Order service shows "Owns orders"; Plan reviews tab lists "Gift cards at checkout" and "Serve the catalog from a headless CMS"; selecting the first shows `+ Gift card service` (dashed new), `~` marks, the rule check text; selecting the move-catalog one shows the struck-through Catalog store and `agentic/T-20261024-ab12-move-catalog`; reload on the review URL keeps the selection; switching to `plain` renders one block; a screenshot of each tab is attached (`testInfo.attach`, opt-in as in `workflow-plain-task.spec.ts`).
- [ ] **Step 2: Run** `npx jest --selectProjects frontend ArchitectPage` → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test`, `npm run build`, `npm run test:ui -- architecture` (needs the built app and Chromium; if the browser is missing say so) → PASS.
- [ ] **Step 5: Commit** `Architect: the page, App wiring and Playwright spec`.

---

### Task 10: Deployment, README, CLAUDE.md

**Files:**
- Modify: `Dockerfile` (final stage: `apt-get install -y --no-install-recommends git ca-certificates` before `USER node`, clean lists; ensure `/data` stays owned by node), `compose.yaml` (`ARCHITECTURE_ENABLED: ${ARCHITECTURE_ENABLED:-}`, `ARCHITECTURE_DATA_DIR: /data/architecture`, `ARCHITECTURE_FETCH_SECONDS` from env), `.env.example` (ARCHITECTURE_* with comments), `README.md` (routes with example responses, variables table row(s), "Architect" section: what files it reads, how to produce them with the architect skill, `git` required, private repositories via `GH_TOKEN`), `CLAUDE.md` (a bullet "Architecture (`backend/src/…`)" in the style of the others: layers, `RepositoryFiles`, validator, fetch rule, route list, security, frontend files, tests, `start:local`; mention that `commons/git-credential-env.ts` is shared), `backend/test/unit/deploy/*` if a test pins the Dockerfile/compose (check `backend/test/unit/deploy`)
- Test: existing deploy specs pass; add a case if they enumerate compose env.

- [ ] **Step 1:** Look at `backend/test/unit/deploy/*.spec.ts`; extend the failing assertions first (Dockerfile installs git; compose passes `ARCHITECTURE_*`). **Step 2:** run → FAIL. **Step 3:** edit files. **Step 4:** `npm test`, `npm run lint` → PASS. **Step 5: Commit** `Architect: git in the image, compose and env, README and CLAUDE.md`.
