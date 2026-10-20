#!/usr/bin/env node
// Builds the app and runs it in the foreground with the local launcher (no Docker):
//   PORT=3101 npm run start:local
// Defaults, each overridden by the same variable in the environment: PORT 3100,
// ENGINE_REPO_URL = this checkout, ENGINE_PROJECT = its folder name, ENGINE_LOCAL_AGENT = fake, ENGINE_GIT_NAME/EMAIL = a dummy identity.
// ENGINE_DATA_DIR is always <checkout>/.local/<port>/ and is wiped at every start; so are the backlog's and the
// workflow runs' data (<data>/backlog, <data>/workflow-runs) when BACKLOG_CONFIG / WORKFLOWS_DIR are set and their
// data dirs are not. The in-memory backlog connector (`connector: memory`) is allowed here only (see local-env.cjs).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { buildAppEnv, redactRepoUrl } = createRequire(import.meta.url)('./local-env.cjs');

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

const env = buildAppEnv({ processEnv: process.env, root, projectName: basename(root), port, dataDir });
const extras = [env.BACKLOG_CONFIG && `backlog ${env.BACKLOG_CONFIG}`, env.WORKFLOWS_DIR && `workflows ${env.WORKFLOWS_DIR}`].filter(Boolean);
console.log(`start:local: port ${port}, data ${dataDir}, repo ${redactRepoUrl(env.ENGINE_REPO_URL)}, agent ${env.ENGINE_LOCAL_AGENT}${extras.map((e) => `, ${e}`).join('')}`);

const app = spawn(process.execPath, [join(root, 'dist/backend/main.js')], { cwd: root, env, stdio: 'inherit' });
// The app shuts down on these (and stops its bridges); wait for it, then leave.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => app.kill(signal));
app.on('exit', (code, signal) => {
  rmSync(pidFile, { force: true });
  process.exit(code ?? (signal ? 128 + (signal === 'SIGINT' ? 2 : 15) : 1));
});
