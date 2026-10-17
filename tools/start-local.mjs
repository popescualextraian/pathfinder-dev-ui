#!/usr/bin/env node
// Builds the app and runs it in the foreground with the local launcher (no Docker):
//   PORT=3101 npm run start:local
// Defaults, each overridden by the same variable in the environment: PORT 3100,
// ENGINE_REPO_URL = this checkout, ENGINE_PROJECT = its folder name, ENGINE_LOCAL_AGENT = fake, ENGINE_GIT_NAME/EMAIL = a dummy identity.
// ENGINE_DATA_DIR is always <checkout>/.local/<port>/ and is wiped at every start.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT?.trim() || '3100';
if (!/^\d+$/.test(port)) {
  console.error('PORT must be a number');
  process.exit(1);
}
const dataDir = join(root, '.local', port);
const pidFile = join(root, '.local', `${port}.pid`); // pid of this script; kill it to stop the app

const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
writeFileSync(pidFile, `${process.pid}\n`);

const env = {
  ENGINE_REPO_URL: root,
  ENGINE_PROJECT: basename(root),
  ENGINE_LOCAL_AGENT: 'fake',
  // The app wants an identity whenever GH_TOKEN is set in the environment.
  ENGINE_GIT_NAME: 'Local Dev',
  ENGINE_GIT_EMAIL: 'local-dev@example.invalid',
  ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== '')),
  ENGINE_LAUNCHER: 'local',
  PORT: port,
  ENGINE_DATA_DIR: dataDir,
};
console.log(`start:local: port ${port}, data ${dataDir}, repo ${env.ENGINE_REPO_URL}, agent ${env.ENGINE_LOCAL_AGENT}`);

const app = spawn(process.execPath, [join(root, 'dist/backend/main.js')], { cwd: root, env, stdio: 'inherit' });
// The app shuts down on these (and stops its bridges); wait for it, then leave.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => app.kill(signal));
app.on('exit', (code, signal) => {
  rmSync(pidFile, { force: true });
  process.exit(code ?? (signal ? 128 + (signal === 'SIGINT' ? 2 : 15) : 1));
});
