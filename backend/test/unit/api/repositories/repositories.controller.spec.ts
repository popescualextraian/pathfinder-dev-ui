import { RepositoriesController } from '../../../../src/api/repositories/repositories.controller';

describe('RepositoriesController', () => {
  it('returns what the service lists', () => {
    const list = [{ name: 'a', url: 'https://github.com/x/a', default: true }];
    expect(new RepositoriesController({ list: () => list } as never).list()).toBe(list);
  });
});
