import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { SessionView, TaskUpdates, TaskView } from '../../../../src/engine';
import { EngineWorkflowTasks } from '../../../../src/integration/workflow/engine-workflow-tasks';

function session(name: string, patch: Partial<SessionView> = {}): SessionView {
  return { name, state: 'idle', createdAt: '2026-10-20T10:00:00.000Z', questions: 0, ...patch };
}

function view(patch: Partial<TaskView> = {}): TaskView {
  return {
    id: 'T-20261020-abcd', title: '#7 Fix it', prompt: 'p', repository: 'repo', repoUrl: 'https://example.test/r.git',
    branch: 'agentic/T-20261020-abcd', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    state: 'idle', section: 'in-review', questions: [], sessions: [session('main')], closed: false, ...patch,
  };
}

function make() {
  const tasks = {
    start: jest.fn().mockResolvedValue(view()),
    addSession: jest.fn().mockResolvedValue(view()),
    prompt: jest.fn().mockResolvedValue(view()),
    get: jest.fn().mockResolvedValue(view()),
    hasFiles: jest.fn().mockResolvedValue({ 'a.md': true }),
  };
  const updates = new TaskUpdates();
  return { tasks, updates, adapter: new EngineWorkflowTasks(tasks as never, updates) };
}

describe('EngineWorkflowTasks', () => {
  it('starts a task in the default repository with title, prompt and model and returns its id', async () => {
    const { tasks, adapter } = make();
    expect(await adapter.start({ title: '#7 Fix it', prompt: 'Plan #7', model: 'sonnet' })).toBe('T-20261020-abcd');
    expect(tasks.start).toHaveBeenCalledWith({ title: '#7 Fix it', prompt: 'Plan #7', model: 'sonnet' });
  });

  it('leaves the model out when none is given', async () => {
    const { tasks, adapter } = make();
    await adapter.start({ title: 't', prompt: 'p' });
    expect(tasks.start).toHaveBeenCalledWith({ title: 't', prompt: 'p' });
  });

  it('adds a session with fork and model, and prompts a session', async () => {
    const { tasks, adapter } = make();
    await adapter.addSession('T-1', { name: 'review', prompt: 'Review', fork: 'impl', model: 'sonnet' });
    expect(tasks.addSession).toHaveBeenCalledWith('T-1', { name: 'review', prompt: 'Review', forkFrom: 'impl', model: 'sonnet' });
    await adapter.addSession('T-1', { name: 'impl', prompt: 'Go' });
    expect(tasks.addSession).toHaveBeenLastCalledWith('T-1', { name: 'impl', prompt: 'Go' });
    await adapter.prompt('T-1', 'impl', 'Exit now');
    expect(tasks.prompt).toHaveBeenCalledWith('T-1', 'Exit now', 'impl');
  });

  it('maps the task view to a snapshot', async () => {
    const { tasks, adapter } = make();
    tasks.get.mockResolvedValue(view({
      state: 'running',
      sessions: [
        session('main', { state: 'idle', lastMessageAt: '2026-10-20T10:05:00.000Z', lastMessage: 'secret-ish text' }),
        session('impl', { state: 'waiting', questions: 2 }),
      ],
    }));
    expect(await adapter.get('T-20261020-abcd')).toEqual({
      id: 'T-20261020-abcd', state: 'running', branch: 'agentic/T-20261020-abcd',
      sessions: [
        { name: 'main', state: 'idle', openQuestions: 0, lastMessageAt: '2026-10-20T10:05:00.000Z' },
        { name: 'impl', state: 'waiting', openQuestions: 2 },
      ],
    });
    expect(tasks.get).toHaveBeenCalledWith('T-20261020-abcd');
  });

  it('gives the reason of a failed or stopped task', async () => {
    const { tasks, adapter } = make();
    tasks.get.mockResolvedValue(view({ state: 'failed', reason: 'agent crashed' }));
    expect(await adapter.get('T-1')).toMatchObject({ state: 'failed', failureReason: 'agent crashed' });
  });

  it('reports a closed task as stopped', async () => {
    const { tasks, adapter } = make();
    tasks.get.mockResolvedValue(view({ state: 'idle', closed: true, sessions: [session('main', { state: 'idle' })] }));
    const snap = await adapter.get('T-1');
    expect(snap?.state).toBe('stopped');
    expect(snap?.sessions[0].state).toBe('stopped');
  });

  it('shows a state it does not know as starting (neither busy nor done)', async () => {
    const { tasks, adapter } = make();
    tasks.get.mockResolvedValue(view({ state: 'mystery', sessions: [session('main', { state: 'mystery' })] }));
    const snap = await adapter.get('T-1');
    expect(snap?.state).toBe('starting');
    expect(snap?.sessions[0].state).toBe('starting');
  });

  it('resolves undefined for a task that is gone, and passes other errors on', async () => {
    const { tasks, adapter } = make();
    tasks.get.mockRejectedValue(new NotFoundException('Task T-1 not found'));
    expect(await adapter.get('T-1')).toBeUndefined();
    tasks.get.mockRejectedValue(new Error('disk'));
    await expect(adapter.get('T-1')).rejects.toThrow('disk');
  });

  it('passes hasFiles through', async () => {
    const { tasks, adapter } = make();
    expect(await adapter.hasFiles('T-1', ['a.md'])).toEqual({ 'a.md': true });
    expect(tasks.hasFiles).toHaveBeenCalledWith('T-1', ['a.md']);
  });

  it('turns task changes and removals into task ids', () => {
    const { updates, adapter } = make();
    const seen: string[] = [];
    const sub = adapter.changes.subscribe((id) => seen.push(id));
    updates.changed(view({ id: 'T-a' }));
    updates.removed('T-b');
    sub.unsubscribe();
    updates.removed('T-c');
    expect(seen).toEqual(['T-a', 'T-b']);
  });

  describe('when the task was created but its start failed afterwards (bridge not ready)', () => {
    it('recovers the new task id from the engine announcement and lets the run go on', async () => {
      const { tasks, updates, adapter } = make();
      const later = () => new Date(Date.now() + 5).toISOString();
      tasks.start.mockImplementation(async () => {
        // An older task of the same item (an earlier run) changes meanwhile: not ours.
        updates.changed(view({ id: 'T-old', title: '#7 Fix it', prompt: 'Plan #7', createdAt: '2020-01-01T00:00:00.000Z' }));
        updates.changed(view({ id: 'T-new', title: '#7 Fix it', prompt: 'Plan #7', createdAt: later() }));
        throw new BadGatewayException('Task T-new was created but its bridge did not become ready: timeout');
      });
      expect(await adapter.start({ title: '#7 Fix it', prompt: 'Plan #7' })).toBe('T-new');
    });

    it('matches the title as the engine shortens it', async () => {
      const { tasks, updates, adapter } = make();
      const long = `#7 ${'word '.repeat(30)}`.trim();
      tasks.start.mockImplementation(async () => {
        updates.changed(view({ id: 'T-new', title: `${long.slice(0, 79).trimEnd()}…`, prompt: 'p', createdAt: new Date(Date.now() + 5).toISOString() }));
        throw new BadGatewayException('not ready');
      });
      expect(await adapter.start({ title: long, prompt: 'p' })).toBe('T-new');
    });

    it('ignores announcements of other tasks and rethrows when no task of ours was created', async () => {
      const { tasks, updates, adapter } = make();
      tasks.start.mockImplementation(async () => {
        updates.changed(view({ id: 'T-x', title: 'Something else', prompt: 'Plan #7', createdAt: new Date(Date.now() + 5).toISOString() }));
        updates.changed(view({ id: 'T-y', title: '#7 Fix it', prompt: 'other prompt', createdAt: new Date(Date.now() + 5).toISOString() }));
        throw new BadGatewayException('At most 2 tasks');
      });
      await expect(adapter.start({ title: '#7 Fix it', prompt: 'Plan #7' })).rejects.toThrow('At most 2 tasks');
    });
  });
});
