import { MemoryConnector } from '../../../../../src/backlog/integration/memory/memory-connector';
import { BacklogConfig } from '../../../../../src/backlog/service/backlog-config';
import { BacklogConflictError, BacklogInvalidError, BacklogNotFoundError } from '../../../../../src/backlog/service/backlog-errors';

const config = (items: NonNullable<BacklogConfig['memory']>['items']): BacklogConfig => ({
  connector: 'memory',
  memory: { items },
  pollSeconds: 60,
  doneDays: 14,
  dataDir: '/unused',
  lanes: [
    { id: 'todo', title: 'Todo', default: true },
    { id: 'plan', title: 'Plan' },
    { id: 'done', title: 'Done', gitlab: { state: 'closed' } },
  ],
});

describe('MemoryConnector', () => {
  let connector: MemoryConnector;
  beforeEach(() => {
    connector = new MemoryConnector(config([{ title: 'First', description: 'Text' }, { title: 'Second', lane: 'plan' }]));
  });

  it('seeds the items from the config, numbered from 1, in the default lane unless given', async () => {
    const items = await connector.list();
    expect(items).toEqual([
      { id: '1', title: 'First', description: 'Text', lane: 'todo', assignees: [], url: 'memory://items/1', fileLinks: [], updatedAt: expect.any(String) },
      { id: '2', title: 'Second', description: '', lane: 'plan', assignees: [], url: 'memory://items/2', fileLinks: [], updatedAt: expect.any(String) },
    ]);
    await expect(connector.get('2')).resolves.toMatchObject({ title: 'Second' });
    await expect(connector.get('9')).rejects.toThrow(BacklogNotFoundError);
    await expect(connector.me()).resolves.toBe('local');
  });

  it('moves with {from,to}: a conflict when the source lane differs, unknown items are not found', async () => {
    await expect(connector.moveToLane('1', 'todo', 'plan')).resolves.toMatchObject({ id: '1', lane: 'plan' });
    await expect(connector.moveToLane('1', 'todo', 'done')).rejects.toThrow(BacklogConflictError);
    await expect(connector.get('1')).resolves.toMatchObject({ lane: 'plan' });
    await expect(connector.moveToLane('9', 'todo', 'plan')).rejects.toThrow(BacklogNotFoundError);
  });

  it('creates into a lane (default lane without one), refusing the closed lane; ids continue after the seed', async () => {
    await expect(connector.create({ title: 'Third' })).resolves.toMatchObject({ id: '3', title: 'Third', description: '', lane: 'todo' });
    await expect(connector.create({ title: 'Fourth', description: 'd', lane: 'plan' })).resolves.toMatchObject({ id: '4', lane: 'plan' });
    await expect(connector.create({ title: 'Closed', lane: 'done' })).rejects.toThrow(BacklogInvalidError);
    expect((await connector.list()).map((i) => i.id)).toEqual(['1', '2', '3', '4']);
  });

  it('updates title, description and assignees but never the lane; keeps file links', async () => {
    await expect(connector.update('1', { title: 'New', assignees: ['me'] })).resolves.toMatchObject({ id: '1', title: 'New', description: 'Text', assignees: ['me'], lane: 'todo' });
    await expect(connector.update('9', { title: 'x' })).rejects.toThrow(BacklogNotFoundError);
    const links = [{ repo: 'r', path: 'p.md' }];
    await expect(connector.setFileLinks('1', links)).resolves.toEqual(links);
    await expect(connector.getFileLinks('1')).resolves.toEqual(links);
    await expect(connector.getFileLinks('9')).rejects.toThrow(BacklogNotFoundError);
  });

  it('returns copies: changing a returned item does not change the store', async () => {
    const item = await connector.get('1');
    item.title = 'changed';
    item.assignees.push('x');
    await expect(connector.get('1')).resolves.toMatchObject({ title: 'First', assignees: [] });
  });
});
