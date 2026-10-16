import { defineConfig } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
    command: 'npm run build && npm start',
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}/api/system/info`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
