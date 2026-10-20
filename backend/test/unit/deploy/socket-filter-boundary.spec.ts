import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '../../../../socket-filter/src');

// The socket filter is its own project (own Dockerfile and package.json): it may import only itself and Node.
describe('socket-filter boundary', () => {
  it('imports nothing from backend/ or any other package', () => {
    const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    const bad = files.flatMap((f) => {
      const text = readFileSync(join(SRC, f), 'utf8');
      const specs = [...text.matchAll(/(?:from|import\()\s*'([^']+)'/g)].map((m) => m[1]);
      return specs.filter((s) => !(s.startsWith('./') || s.startsWith('node:'))).map((s) => `${f} -> ${s}`);
    });
    expect(bad).toEqual([]);
  });
});
