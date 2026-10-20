import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowDefinitionFileRepository } from '../../../../src/workflow/repository/workflow-definition-file.repository';

const GOOD = (title: string, stage = 'plan') => `
title: ${title}
steps:
  - id: a
    title: A
    stage: ${stage}
    sessions: [{ name: main, prompt: hi }]
    gate: auto
`;

describe('WorkflowDefinitionFileRepository', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wf-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lists yaml and yml files, id is the file name without extension, ignores others', async () => {
    writeFileSync(join(dir, 'one.yaml'), GOOD('One'));
    writeFileSync(join(dir, 'two.yml'), GOOD('Two'));
    writeFileSync(join(dir, 'notes.txt'), 'x');
    const r = await new WorkflowDefinitionFileRepository(dir).list();
    expect(r.definitions.map((d) => [d.id, d.title])).toEqual([['one', 'One'], ['two', 'Two']]);
    expect(r.refused).toEqual([]);
  });

  it('refuses a bad file by name and still loads the others', async () => {
    writeFileSync(join(dir, 'good.yaml'), GOOD('Good'));
    writeFileSync(join(dir, 'bad.yaml'), 'title: [oops');
    writeFileSync(join(dir, 'worse.yaml'), 'title: W\nsteps: []\n');
    const r = await new WorkflowDefinitionFileRepository(dir).list();
    expect(r.definitions.map((d) => d.id)).toEqual(['good']);
    expect(r.refused.map((x) => x.file)).toEqual(['bad.yaml', 'worse.yaml']);
    expect(r.refused[0].error).toMatch(/bad\.yaml.*invalid YAML/);
    expect(r.refused[1].error).toMatch(/worse\.yaml.*steps/);
  });

  it('refuses a second file with the same workflow id', async () => {
    writeFileSync(join(dir, 'one.yaml'), GOOD('One'));
    writeFileSync(join(dir, 'one.yml'), GOOD('Other one'));
    const r = await new WorkflowDefinitionFileRepository(dir).list();
    expect(r.definitions.map((d) => [d.id, d.title])).toEqual([['one', 'One']]);
    expect(r.refused).toEqual([{ file: 'one.yml', error: 'one.yml: duplicate workflow id "one" (also one.yaml)', version: expect.any(String) }]);
  });

  it('re-reads on every list', async () => {
    const repo = new WorkflowDefinitionFileRepository(dir);
    expect((await repo.list()).definitions).toEqual([]);
    writeFileSync(join(dir, 'late.yaml'), GOOD('Late'));
    expect((await repo.list()).definitions.map((d) => d.id)).toEqual(['late']);
  });

  it('validates stages with the work items when they offer them', async () => {
    writeFileSync(join(dir, 'x.yaml'), GOOD('X', 'nowhere'));
    const repo = new WorkflowDefinitionFileRepository(dir, { get: jest.fn(), moveTo: jest.fn(), stages: async () => ['plan'] });
    const r = await repo.list();
    expect(r.definitions).toEqual([]);
    expect(r.refused[0]).toMatchObject({ file: 'x.yaml' });
    expect(r.refused[0].error).toMatch(/x\.yaml.*stage "nowhere"/);
  });

  it('get returns one definition or undefined', async () => {
    writeFileSync(join(dir, 'one.yaml'), GOOD('One'));
    const repo = new WorkflowDefinitionFileRepository(dir);
    expect((await repo.get('one'))?.title).toBe('One');
    expect(await repo.get('missing')).toBeUndefined();
  });

  it('a missing directory lists nothing', async () => {
    const r = await new WorkflowDefinitionFileRepository(join(dir, 'nope')).list();
    expect(r).toEqual({ definitions: [], refused: [] });
  });
});
