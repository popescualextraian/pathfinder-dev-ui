import { defineConfig } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ARCHITECTURE_ENV, architectureFixtureRepositories } from './e2e/support/architecture-fixture';

const PORT = 3100;

// Use the Chromium already installed under PLAYWRIGHT_BROWSERS_PATH, whatever its revision;
// without it, Playwright falls back to its own browser lookup.
function installedChromium(): string | undefined {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !existsSync(base)) return undefined;
  const dir = readdirSync(base)
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .pop();
  const executable = dir && join(base, dir, 'chrome-linux64', 'chrome');
  return executable && existsSync(executable) ? executable : undefined;
}

export default defineConfig({
  testDir: 'e2e',
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { executablePath: installedChromium() },
  },
  webServer: {
    // local launcher, real agentic-bridge, fake agent; short poll so state changes show quickly. Backlog in memory
    // (no GitLab) and the test workflows; start:local makes the paths absolute and keeps the data in .local/<port>/.
    command: 'npm run start:local',
    env: {
      PORT: String(PORT), ENGINE_POLL_SECONDS: '2', ENGINE_MAX_RUNNING: '10',
      BACKLOG_CONFIG: 'e2e/fixtures/backlog.yaml', WORKFLOWS_DIR: 'e2e/fixtures/workflows',
      SCHEDULES_TICK_SECONDS: '2', SCHEDULES_TIMEZONE: 'UTC', // the scheduler looks for due schedules every 2 s
      START_LOCAL_COPY_WORKFLOWS: '1', // the editor spec writes: it gets a copy in .local/<port>/workflows
      // Architect page over fixture repositories (bare repos in .local/architecture-fixture-2/, built here once);
      // the default repository stays this checkout.
      ...ARCHITECTURE_ENV, ENGINE_REPOS: architectureFixtureRepositories(),
    },
    url: `http://localhost:${PORT}/api/system/info`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
