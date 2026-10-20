import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdvanceRunDto } from '../../../../src/api/workflows/dto/advance-run.dto';
import { RunsQueryDto } from '../../../../src/api/workflows/dto/runs-query.dto';
import { StartRunDto } from '../../../../src/api/workflows/dto/start-run.dto';

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
