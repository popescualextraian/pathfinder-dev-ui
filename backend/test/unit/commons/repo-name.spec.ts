import { repoNameOf } from '../../../src/commons/repo-name';

describe('repoNameOf', () => {
  it.each([
    ['https://github.com/acme/pathfinder-dev-ui.git', 'pathfinder-dev-ui'],
    ['https://github.com/acme/pathfinder-dev-ui', 'pathfinder-dev-ui'],
    ['https://github.com/acme/pathfinder-dev-ui/', 'pathfinder-dev-ui'],
    ['/seed/my-repo', 'my-repo'],
    ['git@github.com:acme/x.git', 'x'],
  ])('%s -> %s', (url, name) => {
    expect(repoNameOf(url)).toBe(name);
  });
});
