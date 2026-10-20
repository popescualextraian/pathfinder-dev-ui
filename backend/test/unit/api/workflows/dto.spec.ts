import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdvanceRunDto } from '../../../../src/api/workflows/dto/advance-run.dto';
import { RunsQueryDto } from '../../../../src/api/workflows/dto/runs-query.dto';
import { StartRunDto } from '../../../../src/api/workflows/dto/start-run.dto';
import { CreateWorkflowDto, UpdateWorkflowDto, ValidateWorkflowDto, VersionQueryDto } from '../../../../src/api/workflows/dto/workflow-definition.dto';

async function errorsOf<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  return (await validate(plainToInstance(cls, plain))).map((e) => e.property);
}

describe('StartRunDto', () => {
  it('accepts an item id and a workflow id', async () => {
    expect(await errorsOf(StartRunDto, { itemId: '7', workflowId: 'plan-implement-review' })).toEqual([]);
    expect(await errorsOf(StartRunDto, { itemId: 'abc_1.x', workflowId: 'Plan.v2' })).toEqual([]);
  });

  it.each([undefined, '', ' ', 5, '../x', 'a/b', '.hidden', 'x'.repeat(101)])('rejects item id %p', async (itemId) => {
    expect(await errorsOf(StartRunDto, { itemId, workflowId: 'w' })).toContain('itemId');
  });

  it.each([undefined, '', 5, '../w', 'w/x', '.w', 'x'.repeat(101)])('rejects workflow id %p', async (workflowId) => {
    expect(await errorsOf(StartRunDto, { itemId: '7', workflowId })).toContain('workflowId');
  });
});

describe('AdvanceRunDto', () => {
  it('accepts nothing or a boolean force', async () => {
    expect(await errorsOf(AdvanceRunDto, {})).toEqual([]);
    expect(await errorsOf(AdvanceRunDto, { force: true })).toEqual([]);
    expect(await errorsOf(AdvanceRunDto, { force: false })).toEqual([]);
  });

  it.each(['true', 1, 'yes', {}])('rejects force %p', async (force) => {
    expect(await errorsOf(AdvanceRunDto, { force })).toContain('force');
  });
});

describe('RunsQueryDto', () => {
  it('accepts no item or a safe item id', async () => {
    expect(await errorsOf(RunsQueryDto, {})).toEqual([]);
    expect(await errorsOf(RunsQueryDto, { itemId: '42' })).toEqual([]);
  });

  it.each(['', '../x', 'a b'])('rejects item id %p', async (itemId) => {
    expect(await errorsOf(RunsQueryDto, { itemId })).toContain('itemId');
  });
});

describe('workflow definition DTOs', () => {
  const step = { id: 's', title: 'S', gate: 'auto', sessions: [{ name: 'main', prompt: 'p' }] };
  const definition = { title: 'T', steps: [step] };

  it('accepts a definition, optional fields included', async () => {
    expect(await errorsOf(CreateWorkflowDto, { id: 'a-1', definition })).toEqual([]);
    const full = { title: 'T', doneStage: 'done', steps: [{ ...step, stage: 'x', requires: ['a.md'], exitPrompt: 'e', sessions: [{ name: 'main', prompt: 'p', fork: 'f', model: 'm' }] }] };
    expect(await errorsOf(ValidateWorkflowDto, { definition: full })).toEqual([]);
    expect(await errorsOf(UpdateWorkflowDto, { definition, version: 'v' })).toEqual([]);
  });

  it.each(['', 'A', '-a', 'a/b', '../x', 5, undefined])('rejects workflow id %p', async (id) => {
    expect(await errorsOf(CreateWorkflowDto, { id, definition })).toContain('id');
  });

  it.each([
    [{ title: 5, steps: [step] }], [{ title: 'T' }], [{ title: 'T', steps: 'x' }], [{ title: 'T', steps: [{ ...step, gate: 'maybe' }] }],
    [{ title: 'T', steps: [{ ...step, sessions: 'x' }] }], [{ title: 'T', steps: [{ ...step, sessions: [{ name: 1, prompt: 'p' }] }] }],
    [{ title: 'T', steps: [{ ...step, requires: [1] }] }], [{ title: 'T', steps: [{ ...step, stage: 1 }] }], [{ title: 'T', steps: ['x'] }],
  ])('rejects the malformed definition %j', async (bad) => {
    expect(await errorsOf(ValidateWorkflowDto, { definition: bad })).toContain('definition');
  });

  it('rejects a missing definition and a missing version', async () => {
    expect(await errorsOf(ValidateWorkflowDto, {})).toContain('definition');
    expect(await errorsOf(UpdateWorkflowDto, { definition })).toContain('version');
    expect(await errorsOf(VersionQueryDto, {})).toContain('version');
    expect(await errorsOf(VersionQueryDto, { version: 'v' })).toEqual([]);
  });
});
