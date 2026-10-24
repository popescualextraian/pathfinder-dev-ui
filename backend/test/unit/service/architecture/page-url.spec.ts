import { pageBase } from '../../../../src/service/architecture/page-url';

describe('pageBase', () => {
  it('github', () => {
    expect(pageBase('https://github.com/acme/shop.git', 'main')).toBe('https://github.com/acme/shop/blob/main/docs/architecture/');
  });
  it('other hosts use -/blob and encode branch segments', () => {
    expect(pageBase('https://gitlab.example.com/g/sub/r.git', 'feature/a b')).toBe(
      'https://gitlab.example.com/g/sub/r/-/blob/feature/a%20b/docs/architecture/',
    );
  });
  it('strips userinfo', () => {
    const r = pageBase('https://user:secret@github.com/acme/shop', 'main');
    expect(r).toBe('https://github.com/acme/shop/blob/main/docs/architecture/');
    expect(r).not.toContain('secret');
  });
  it('converts scp-style and ssh urls', () => {
    expect(pageBase('git@github.com:acme/shop.git', 'main')).toBe('https://github.com/acme/shop/blob/main/docs/architecture/');
    expect(pageBase('ssh://git@gitlab.x.org/a/b.git', 'm')).toBe('https://gitlab.x.org/a/b/-/blob/m/docs/architecture/');
  });
  it('local paths and garbage give null', () => {
    expect(pageBase('/srv/git/shop.git', 'main')).toBeNull();
    expect(pageBase('file:///srv/git/shop.git', 'main')).toBeNull();
    expect(pageBase('not a url', 'main')).toBeNull();
  });
});
