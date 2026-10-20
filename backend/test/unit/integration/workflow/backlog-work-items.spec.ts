import { BacklogConflictError, BacklogNotFoundError, BacklogUnreachableError, Item } from '../../../../src/backlog';
import { BacklogWorkItems } from '../../../../src/integration/workflow/backlog-work-items';

function item(patch: Partial<Item> = {}): Item {
  return {
    id: '7', title: 'Fix it', description: 'Details', lane: 'backlog', assignees: ['me'], url: 'https://gitlab.test/p/-/issues/7',
    fileLinks: [], updatedAt: '2026-10-20T10:00:00.000Z', ...patch,
  };
}

function make() {
  const backlog = {
    get: jest.fn().mockResolvedValue(item()),
    move: jest.fn().mockImplementation(async (id: string, _from: string, to: string) => item({ id, lane: to })),
    lanes: jest.fn().mockReturnValue({ me: 'me', lanes: [{ id: 'backlog', title: 'Backlog' }, { id: 'plan', title: 'Plan' }, { id: 'done', title: 'Done' }] }),
  };
  return { backlog, items: new BacklogWorkItems(backlog as never) };
}

describe('BacklogWorkItems', () => {
  it('gets an item with its lane as the stage', async () => {
    const { backlog, items } = make();
    expect(await items.get('7')).toEqual({
      id: '7', title: 'Fix it', description: 'Details', url: 'https://gitlab.test/p/-/issues/7', stage: 'backlog',
    });
    expect(backlog.get).toHaveBeenCalledWith('7');
  });

  it('resolves undefined for an unknown item and passes other errors on', async () => {
    const { backlog, items } = make();
    backlog.get.mockRejectedValue(new BacklogNotFoundError());
    expect(await items.get('8')).toBeUndefined();
    backlog.get.mockRejectedValue(new BacklogUnreachableError());
    await expect(items.get('8')).rejects.toBeInstanceOf(BacklogUnreachableError);
  });

  it('moves an item like the board does: from its current lane to the stage', async () => {
    const { backlog, items } = make();
    await items.moveTo('7', 'plan');
    expect(backlog.move).toHaveBeenCalledWith('7', 'backlog', 'plan');
  });

  it('does not move an item that is in the stage already', async () => {
    const { backlog, items } = make();
    backlog.get.mockResolvedValue(item({ lane: 'plan' }));
    await items.moveTo('7', 'plan');
    expect(backlog.move).not.toHaveBeenCalled();
  });

  it('retries once from the lane the source reports when the board copy was stale', async () => {
    const { backlog, items } = make();
    backlog.get.mockResolvedValueOnce(item({ lane: 'backlog' })).mockResolvedValueOnce(item({ lane: 'review' }));
    backlog.move.mockRejectedValueOnce(new BacklogConflictError());
    await items.moveTo('7', 'plan');
    expect(backlog.move.mock.calls).toEqual([['7', 'backlog', 'plan'], ['7', 'review', 'plan']]);
  });

  it('gives up after the second conflict', async () => {
    const { backlog, items } = make();
    backlog.move.mockRejectedValue(new BacklogConflictError());
    await expect(items.moveTo('7', 'plan')).rejects.toBeInstanceOf(BacklogConflictError);
    expect(backlog.move).toHaveBeenCalledTimes(2);
  });

  it('lists the lane ids as stages', () => {
    const { items } = make();
    expect(items.stages()).toEqual(['backlog', 'plan', 'done']);
  });
});
