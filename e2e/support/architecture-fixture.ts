import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeFixtureRepo } from '../../backend/test/helpers/architecture-repo';

// The architecture fixture repositories of the Playwright app: bare repos `acme-shop` (the fixture model, its
// full review, two plan-review branches), `plain` (a one-part model, no modules) and `nodocs` (no doc). Built once into
// .local/architecture-fixture-2/ (git-ignored) and kept: the config is loaded by the runner and by every worker, so
// the build goes to a temporary folder that is renamed into place; whoever renames second throws its copy away.

const ROOT = resolve(__dirname, '..', '..', '.local', 'architecture-fixture-2');
const DONE = '.complete';
const NAMES = ['acme-shop', 'plain', 'nodocs'] as const;

function build(): void {
  if (existsSync(join(ROOT, DONE))) return;
  // ROOT only ever appears complete (by the atomic rename below), so it is never removed here.
  mkdirSync(resolve(ROOT, '..'), { recursive: true });
  const tmp = mkdtempSync(`${ROOT}.tmp-`);
  try {
    makeFixtureRepo({ root: tmp, name: 'acme-shop', model: 'fixture' });
    makeFixtureRepo({ root: tmp, name: 'plain', model: 'one-part' });
    // `nodocs`: a repository without an architecture doc (the empty state).
    const nodocs = makeFixtureRepo({ root: tmp, name: 'nodocs', model: 'one-part', extraBranches: false });
    nodocs.commit('main', { 'docs/architecture/model.json': null }, 'Remove the doc');
    writeFileSync(join(tmp, DONE), '');
    try {
      renameSync(tmp, ROOT);
    } catch (e) {
      // The target now exists (someone else's finished copy): ours is removed below. Anything else is an error.
      if (!existsSync(join(ROOT, DONE))) throw e;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** `ENGINE_REPOS` (JSON) naming the fixture repositories by absolute path (the local launcher allows paths). */
export function architectureFixtureRepositories(): string {
  build();
  return JSON.stringify(NAMES.map((name) => ({ name, url: join(ROOT, `${name}.git`) })));
}

/** The architecture settings of the Playwright app: on, and a short fetch interval. */
export const ARCHITECTURE_ENV = { ARCHITECTURE_ENABLED: '1', ARCHITECTURE_FETCH_SECONDS: '5' };
