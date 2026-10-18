import { TaskUpdates } from '../../../../src/engine/service/task-updates';
import { toView } from '../../../../src/engine/service/task-view';
import { record } from './helpers';

describe('TaskUpdates', () => {
  it('delivers changes and removals to every subscriber, replaying nothing', () => {
    const updates = new TaskUpdates();
    const early: unknown[] = [];
    const late: unknown[] = [];
    updates.changed(toView(record()));
    updates.changes.subscribe((c) => early.push(c));
    updates.changes.subscribe((c) => late.push(c));
    updates.changed(toView(record()));
    updates.removed('T-20260101-abcd');
    expect(early).toEqual([{ kind: 'task', task: expect.objectContaining({ id: 'T-20260101-abcd' }) }, { kind: 'removed', id: 'T-20260101-abcd' }]);
    expect(late).toEqual(early);
  });

  it('keeps a note of acted-on tasks until it is cleared, or the task is removed', () => {
    const updates = new TaskUpdates();
    updates.markActed('a');
    updates.markActed('b');
    expect([...updates.actedIds()]).toEqual(['a', 'b']);
    updates.clearActed('a');
    updates.removed('b');
    expect([...updates.actedIds()]).toEqual([]);
  });

  it('hands out a copy of the note', () => {
    const updates = new TaskUpdates();
    updates.markActed('a');
    (updates.actedIds() as Set<string>).clear();
    expect([...updates.actedIds()]).toEqual(['a']);
  });
});
