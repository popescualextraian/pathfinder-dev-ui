import { RepositoriesService } from '../../../../src/service/repositories/repositories.service';

describe('RepositoriesService', () => {
  it('lists the configured repositories, the default first', () => {
    const repositories = [
      { name: 'a', url: 'https://github.com/x/a', default: false },
      { name: 'b', url: 'https://github.com/x/b', default: true },
    ];
    const service = new RepositoriesService({ repositories } as never);
    expect(service.list().map((r) => r.name)).toEqual(['b', 'a']);
  });

  it('returns copies', () => {
    const service = new RepositoriesService({ repositories: [{ name: 'a', url: 'https://github.com/x/a', default: true }] } as never);
    service.list()[0].name = 'changed';
    expect(service.list()[0].name).toBe('a');
  });
});
