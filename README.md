# agentic-dev-base UI

Skeleton of the UI for agentic-dev-base: a NestJS (TypeScript) backend that serves a React frontend.
One small slice shows the layers: `GET /api/system/info` returns `{ name, version, uptimeSeconds }`,
and the frontend displays it.

## Install

```sh
npm install
```

Needs Node 22+.

## Build and run

```sh
npm run build   # backend -> dist/, frontend (Vite) -> dist/frontend
npm start       # http://localhost:3000 (set PORT to change)
```

The frontend is served at `/`, the API under `/api`. For frontend development,
run `npm start` and, in a second terminal, `npm run dev:frontend` (Vite proxies `/api` to port 3000).

## Test

| Command | What |
|---|---|
| `npm test` | Jest unit tests: backend (`src/**/*.spec.ts`) and frontend (`frontend/src/**/*.spec.ts(x)`, jsdom + React Testing Library) |
| `npm run test:e2e` | Backend e2e tests (`test/`, Jest + supertest). Needs a prior `npm run build` for the frontend tests. |
| `npm run test:ui` | Playwright (`e2e/`). Builds and starts the app on port 3100, uses the Chromium under `PLAYWRIGHT_BROWSERS_PATH` if set. |
| `npm run lint` | ESLint for `src/` and `test/` |

## Layout

```
src/
  main.ts, app.setup.ts   bootstrap; global prefix /api, pipe, interceptor, filters
  app.module.ts           imports the api modules and serves dist/frontend
  api/<area>/             controllers (HTTP only, no business logic)
  service/<area>/         business logic
  repository/<area>/      data access (here: package.json)
  commons/                validation pipe, logging interceptor, exception filters, shared utilities
test/                     backend e2e tests
frontend/src/
  api/                    the only code that calls the backend
  state/                  hooks holding the data
  views/                  components; they use state, never api/
e2e/                      Playwright tests
```

## Layer rules

- Backend dependencies go only downwards: `api` → `service` → `repository` → `commons`.
- Each area has one Nest module per layer (`<Area>ApiModule`, `<Area>ServiceModule`,
  `<Area>RepositoryModule`); a layer's module imports only the module of the layer below.
- Routes are prefixed with the area: `/api/<area>/...`.
- Cross-cutting concerns (validation, logging, errors) live in pipes, interceptors and filters
  in `commons/`, registered globally in `app.setup.ts`, not in each method.
- Frontend: `views` → `state` → `api`.
