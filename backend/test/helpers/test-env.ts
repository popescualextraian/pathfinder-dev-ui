import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Made-up secrets: tests check that these never show up in a response.
export const FAKE_GH_TOKEN = 'ghp_made-up-github-token-0123456789';
export const FAKE_OAUTH_TOKEN = 'made-up-oauth-token-9876543210';

// Sets the engine configuration the app needs to start; returns the temporary data directory.
export function setTestEnv(maxRunning = 2): string {
  const dataDir = mkdtempSync(join(tmpdir(), 'engine-e2e-'));
  Object.assign(process.env, {
    ENGINE_LAUNCHER: 'docker',
    ENGINE_IMAGE: 'made-up-image:test',
    ENGINE_DOCKER_NETWORK: 'made-up-network',
    ENGINE_DATA_DIR: dataDir,
    ENGINE_REPO_URL: 'https://github.com/acme/default.git',
    ENGINE_PROJECT: 'made-up-project',
    ENGINE_MAX_RUNNING: String(maxRunning),
    ENGINE_GIT_NAME: 'Made Up Bot',
    ENGINE_GIT_EMAIL: 'made-up-bot@example.invalid',
    SCHEDULES_DATA_DIR: join(dataDir, 'schedules'),
    SCHEDULES_TIMEZONE: 'UTC',
    SCHEDULES_TICK_SECONDS: '3600',
    GH_TOKEN: FAKE_GH_TOKEN,
    CLAUDE_CODE_OAUTH_TOKEN: FAKE_OAUTH_TOKEN,
  });
  return dataDir;
}
