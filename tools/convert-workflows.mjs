#!/usr/bin/env node
// Rewrites every old-format workflow file (steps with `sessions:`) in a folder to the format of task 015
// (a step has one prompt, optional model/continue/fork). Uses the validator and serializer of the editor from the
// build, so run `npx nest build` first. Comments of the files are lost. A step with more than one session is refused:
// that file is left unchanged and the exit code is 1.
//
//   npx nest build && node tools/convert-workflows.mjs <dir>
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = process.argv[2];
if (!dir || process.argv.length > 3) {
  console.error('usage: node tools/convert-workflows.mjs <workflows folder>');
  process.exit(2);
}

const built = join(dirname(fileURLToPath(import.meta.url)), '../dist/backend/workflow/service/convert-old-workflow.js');
let convert;
try {
  ({ convertOldWorkflowText: convert } = await import(pathToFileURL(built).href));
} catch (error) {
  console.error(`cannot load ${built}: run "npx nest build" first (${error.code ?? error.message})`);
  process.exit(2);
}

let refused = 0;
const files = (await readdir(resolve(dir))).filter((f) => /\.ya?ml$/.test(f)).sort();
for (const file of files) {
  const path = join(resolve(dir), file);
  const result = convert(file.replace(/\.ya?ml$/, ''), await readFile(path, 'utf8'));
  if (result.kind === 'converted') {
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, result.text);
    await rename(temp, path);
    console.log(`converted ${file}`);
  } else if (result.kind === 'refused') {
    refused += 1;
    console.error(`REFUSED ${file}: ${result.error}`);
  } else {
    console.log(`unchanged ${file}`);
  }
}
process.exit(refused > 0 ? 1 : 0);
