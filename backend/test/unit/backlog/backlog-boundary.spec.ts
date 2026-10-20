import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const SRC = resolve(__dirname, '../../../src');
const BACKLOG = join(SRC, 'backlog');
const COMMONS = join(SRC, 'commons');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => join(e.parentPath, e.name));
}

// Every relative import of a file, resolved to an absolute path without extension.
function relativeImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/from '(\.[^']*)'/g)].map((m) => resolve(dirname(file), m[1]));
}

const inside = (path: string, dir: string) => path === dir || path.startsWith(dir + sep);

describe('backlog boundary', () => {
  it('imports nothing from the backend but itself and commons', () => {
    const outside = sources(BACKLOG).flatMap((file) =>
      relativeImports(file)
        .filter((target) => !inside(target, BACKLOG) && !inside(target, COMMONS))
        .map((target) => `${relative(SRC, file)} -> ${relative(SRC, target)}`));
    expect(outside).toEqual([]);
  });

  it('is used from outside only through its index', () => {
    const deep = sources(SRC)
      .filter((file) => !inside(file, BACKLOG))
      .flatMap((file) => relativeImports(file)
        .filter((target) => inside(target, BACKLOG) && target !== BACKLOG && target !== join(BACKLOG, 'index'))
        .map((target) => `${relative(SRC, file)} -> ${relative(SRC, target)}`));
    expect(deep).toEqual([]);
  });
});
