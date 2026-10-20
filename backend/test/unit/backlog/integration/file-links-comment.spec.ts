import { parseFileLinks, renderFileLinks } from '../../../../src/backlog/integration/gitlab/file-links-comment';

describe('file links comment', () => {
  const links = [
    { repo: 'group/project', path: 'src/a.ts', ref: 'main', note: 'entry -->' },
    { repo: 'https://example.org/x.git', path: 'b.md' },
  ];

  it('round-trips links, including text that looks like a comment end', () => {
    const body = renderFileLinks(links);
    expect(body).toContain('`group/project:src/a.ts@main`');
    expect(parseFileLinks(body)).toEqual(links);
  });

  it('round-trips an empty list', () => {
    expect(parseFileLinks(renderFileLinks([]))).toEqual([]);
  });

  it('returns undefined without the marker', () => {
    expect(parseFileLinks('just a human note')).toBeUndefined();
  });

  it('returns undefined for a malformed block', () => {
    expect(parseFileLinks('<!-- pathfinder:file-links v1\n{nope\n-->')).toBeUndefined();
    expect(parseFileLinks('<!-- pathfinder:file-links v1\n[{"repo":1,"path":"x"}]\n-->')).toBeUndefined();
    expect(parseFileLinks('<!-- pathfinder:file-links v1\n{"repo":"a","path":"b"}\n-->')).toBeUndefined();
  });

  it('ignores a human note that quotes the marker in its readable part', () => {
    const quoted = `I saw this comment:\n> ${renderFileLinks(links).split('\n').join('\n> ')}`;
    expect(parseFileLinks(quoted)).toBeUndefined();
  });
});
