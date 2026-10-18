import { Logger } from '@nestjs/common';
import { TaskCostReader } from '../../../../src/engine/service/task-cost-reader';
import { TaskUpdates } from '../../../../src/engine/service/task-updates';
import { fakeLauncher, fakeRecords, ledgerLine, record } from './helpers';

function setup(rec = record()) {
  const records = fakeRecords([rec]);
  const launcher = fakeLauncher();
  const updates = new TaskUpdates();
  const published: { task?: { cost?: { input: number } } }[] = [];
  updates.changes.subscribe((c) => published.push(c as never));
  return { records, launcher, published, reader: new TaskCostReader(records as never, launcher as never, updates) };
}

describe('TaskCostReader.refresh', () => {
  beforeEach(() => { jest.spyOn(Logger.prototype, 'warn').mockImplementation(); });
  afterEach(() => jest.restoreAllMocks());

  it('stores the summarized cost and announces the task', async () => {
    const { reader, launcher, records, published } = setup();
    launcher.readLedger.mockResolvedValue(ledgerLine());
    await reader.refresh(records.map.get(record().id)!);
    expect(records.map.get(record().id)!.cost).toMatchObject({ input: 100, output: 20, usd: { estimate: 0.5 } });
    expect(published[0].task?.cost?.input).toBe(100);
  });

  it.each([
    ['a failed read', async () => { throw new Error('boom'); }],
    ['no ledger', async () => undefined],
    ['no valid line', async () => 'garbage\n'],
  ])('%s keeps the stored value', async (_name, read) => {
    const cost = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, usd: {}, sessions: 1, snapshotAt: 'x', readAt: 'y' };
    const { reader, launcher, records, published } = setup(record({ cost }));
    launcher.readLedger.mockImplementation(read as never);
    await expect(reader.refresh(records.map.get(record().id)!)).resolves.toBeUndefined();
    expect(records.map.get(record().id)!.cost).toEqual(cost);
    expect(published).toHaveLength(0);
  });
});
