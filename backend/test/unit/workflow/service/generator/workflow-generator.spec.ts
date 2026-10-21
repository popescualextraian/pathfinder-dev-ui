import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RetryDelays, WorkflowConflictError, WorkflowFileTooLargeError, WorkflowGenerationFileRepository, WorkflowGenerationView, WorkflowGenerator,
  WorkflowInvalidError, WorkflowNotFoundError, WorkItems,
} from '../../../../../src/workflow';
import { FakeWorkflowTasks } from '../../../../helpers/fake-workflow';

const STAGES = ['todo', 'plan', 'in-progress', 'done'];
const DRAFT = 'workflow-draft.yaml';

const VALID = `title: Plan and do
steps:
  - id: plan
    title: Plan
    stage: plan
    gate: human
    prompt: Plan {{item.title}}
  - id: do
    title: Do
    gate: auto
    continue: plan
    prompt: Do it on {{task.branch}}
`;
const BAD_STAGE = VALID.replace('stage: plan', 'stage: nowhere');
const BAD_YAML = 'title: [unclosed\n';

const DAY = 24 * 60 * 60 * 1000;

describe('WorkflowGenerator', () => {
  let dir: string;
  let tasks: FakeWorkflowTasks;
  let items: WorkItems;
  let now: Date;
  let generator: WorkflowGenerator;
  const clock = () => now;

  const make = async (retry?: RetryDelays): Promise<WorkflowGenerator> => {
    const g = new WorkflowGenerator(tasks, items, new WorkflowGenerationFileRepository(dir), retry, clock);
    await g.onModuleInit();
    return g;
  };
  // Tell the generator the task changed and wait until it has processed it.
  const changed = async (taskId: string, g = generator): Promise<WorkflowGenerationView> => {
    tasks.emit(taskId);
    await g.settled();
    const open = (await g.list()).find((x) => x.taskId === taskId);
    if (!open) throw new Error(`no open generation of ${taskId}`);
    return g.get(open.id);
  };
  const viewOf = async (id: string, g = generator) => g.get(id);
  // The agent wrote `text` (null: no file) and its turn ended.
  const turnEnds = async (taskId: string, text: string | null): Promise<WorkflowGenerationView> => {
    if (text === null) tasks.fileContents.delete(DRAFT); else tasks.fileContents.set(DRAFT, text);
    tasks.setSession(taskId, 'main', { state: 'running' });
    tasks.emit(taskId);
    tasks.finishTurn(taskId, 'main');
    tasks.emit(taskId);
    await generator.settled();
    const id = (await generator.list()).find((x) => x.taskId === taskId)?.id;
    return id ? generator.get(id) : (undefined as never);
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'wfgen-'));
    tasks = new FakeWorkflowTasks();
    items = { get: async () => undefined, moveTo: async () => undefined, stages: () => STAGES };
    now = new Date('2026-10-21T10:00:00.000Z');
    generator = await make();
  });

  afterEach(() => {
    generator.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('start', () => {
    it('starts a generator task with the filled skill and returns a writing generation, stored mode 600', async () => {
      const g = await generator.start('A plan step, then implement.\nFAKE_WRITE:x', 'opus');
      expect(tasks.starts).toHaveLength(1);
      const start = tasks.starts[0];
      expect(start.kind).toBe('workflow-generator');
      expect(start.model).toBe('opus');
      expect(start.title).toBe('Workflow generator: A plan step, then implement.');
      expect(start.prompt).toContain('A plan step, then implement.\nFAKE_WRITE:x');
      expect(start.prompt).toContain('- `in-progress`');
      expect(g).toMatchObject({
        taskId: 'T-20261020-0001', description: 'A plan step, then implement.\nFAKE_WRITE:x', model: 'opus', state: 'writing', attempts: 0,
        createdAt: '2026-10-21T10:00:00.000Z', updatedAt: '2026-10-21T10:00:00.000Z',
      });
      expect(g.id).toMatch(/^G-20261021-[a-z0-9]{8}$/);
      expect(g).not.toHaveProperty('turn');
      const sub = join(dir);
      expect(readdirSync(sub)).toEqual([`${g.id}.json`]);
      expect(statSync(join(sub, `${g.id}.json`)).mode & 0o777).toBe(0o600);
    });

    it('leaves the model out when none (or a blank one) is given', async () => {
      await generator.start('Do it');
      await generator.start('Do it again', '  ');
      expect(tasks.starts.map((s) => 'model' in s)).toEqual([false, false]);
      expect((await generator.list()).map((g) => 'model' in g)).toEqual([false, false]);
    });

    it('refuses an empty or too long description without starting a task', async () => {
      await expect(generator.start('   ')).rejects.toBeInstanceOf(WorkflowInvalidError);
      await expect(generator.start('x'.repeat(4001))).rejects.toBeInstanceOf(WorkflowInvalidError);
      expect(tasks.starts).toHaveLength(0);
    });

    it('passes a failed task start on and records nothing', async () => {
      tasks.start = async () => { throw new Error('At most 2 tasks'); };
      await expect(generator.start('Do it')).rejects.toThrow('At most 2 tasks');
      expect(await generator.list()).toEqual([]);
    });
  });

  describe('turns and the check', () => {
    it('waits while the session only reads idle after the start, then a valid draft makes it ready', async () => {
      const { id, taskId } = await generator.start('Do it');
      tasks.setSession(taskId, 'main', { state: 'idle' });
      tasks.fileContents.set(DRAFT, VALID);
      tasks.emit(taskId);
      await generator.settled();
      expect((await viewOf(id)).state).toBe('writing');
      expect(tasks.readFileCalls).toEqual([]);

      const g = await turnEnds(taskId, VALID);
      expect(tasks.readFileCalls).toEqual([DRAFT]);
      expect(g.state).toBe('ready');
      expect(g.draft).toMatchObject({ id: 'draft', title: 'Plan and do', steps: [{ id: 'plan' }, { id: 'do', continue: 'plan' }] });
      expect(g.errors).toBeUndefined();
      expect(tasks.prompts).toEqual([]);
    });

    it('a new final message alone (never seen busy) also ends the turn', async () => {
      const { id, taskId } = await generator.start('Do it');
      tasks.fileContents.set(DRAFT, VALID);
      tasks.finishTurn(taskId, 'main');
      tasks.emit(taskId);
      await generator.settled();
      expect((await viewOf(id)).state).toBe('ready');
    });

    it('sends errors back twice (fixing 1 and 2 of 2), then fails keeping the errors and the parsed draft', async () => {
      const { id, taskId } = await generator.start('Do it');
      let g = await turnEnds(taskId, BAD_STAGE);
      expect(g).toMatchObject({ state: 'fixing', attempts: 1, errors: [{ stepId: 'plan', field: 'stage', message: expect.stringContaining('"nowhere"') }] });
      expect(g.draft).toBeUndefined();
      expect(tasks.prompts).toHaveLength(1);
      expect(tasks.prompts[0]).toMatchObject({ taskId, session: 'main' });
      expect(tasks.prompts[0].text).toContain('"nowhere"');
      expect(tasks.prompts[0].text).toContain('fix 1 of 2');

      // Right after the fix prompt the session still reads idle with the old message: not a new turn.
      tasks.emit(taskId);
      await generator.settled();
      expect((await viewOf(id)).attempts).toBe(1);

      g = await turnEnds(taskId, BAD_YAML);
      expect(g).toMatchObject({ state: 'fixing', attempts: 2, errors: [{ message: expect.stringMatching(/^invalid YAML/) }] });
      expect(tasks.prompts[1].text).toContain('fix 2 of 2');

      g = await turnEnds(taskId, BAD_STAGE);
      expect(g).toMatchObject({ state: 'failed', attempts: 2, errors: [{ stepId: 'plan', field: 'stage' }] });
      expect(g.draft).toMatchObject({ title: 'Plan and do' });
      expect(g.failureReason).toBeUndefined();
      expect(tasks.prompts).toHaveLength(2);
      expect(tasks.readFileCalls).toHaveLength(3);
      expect(tasks.closed).toEqual([]); // the task stays until the human discards

      // Later turns of a failed generation are not checked.
      await turnEnds(taskId, VALID);
      expect((await viewOf(id)).state).toBe('failed');
    });

    it('a failure whose last file does not parse keeps no draft', async () => {
      const { taskId } = await generator.start('Do it');
      await turnEnds(taskId, BAD_YAML);
      await turnEnds(taskId, BAD_YAML);
      const g = await turnEnds(taskId, BAD_YAML);
      expect(g.state).toBe('failed');
      expect(g.draft).toBeUndefined();
    });

    it('a fixed draft is ready', async () => {
      const { taskId } = await generator.start('Do it');
      await turnEnds(taskId, BAD_STAGE);
      const g = await turnEnds(taskId, VALID);
      expect(g).toMatchObject({ state: 'ready', attempts: 1 });
      expect(g.errors).toBeUndefined();
    });

    it('a missing file is an error sent back like the others', async () => {
      const { taskId } = await generator.start('Do it');
      const g = await turnEnds(taskId, null);
      expect(g).toMatchObject({ state: 'fixing', attempts: 1, errors: [{ message: `${DRAFT} was not found at the root of your worktree` }] });
      expect(tasks.prompts[0].text).toContain('was not found');
    });

    it('a file over the cap is an error sent back like the others', async () => {
      const { taskId } = await generator.start('Do it');
      tasks.readFileFailure = new WorkflowFileTooLargeError(`${DRAFT} is larger than 64 KB`);
      const g = await turnEnds(taskId, VALID);
      expect(g).toMatchObject({ state: 'fixing', attempts: 1, errors: [{ message: `${DRAFT} is larger than 64 KB` }] });
      expect(tasks.prompts[0].text).toContain('larger than 64 KB');
    });

    it('another read error is a warning, retried on the next change without using a fix', async () => {
      const { id, taskId } = await generator.start('Do it');
      tasks.readFileFailure = new Error('docker 500');
      let g = await turnEnds(taskId, VALID);
      expect(g).toMatchObject({ state: 'writing', attempts: 0, warning: `could not read ${DRAFT}: docker 500` });
      expect(tasks.prompts).toEqual([]);
      tasks.readFileFailure = undefined;
      tasks.emit(taskId);
      await generator.settled();
      g = await viewOf(id);
      expect(g.state).toBe('ready');
      expect(g.warning).toBeUndefined();
    });

    it('retries a failed action on a timer when the task does not change', async () => {
      generator.onModuleDestroy();
      generator = await make({ initialMs: 5, maxMs: 10 });
      const { id, taskId } = await generator.start('Do it');
      tasks.promptFailure = new Error('bridge 503');
      const g = await turnEnds(taskId, BAD_STAGE);
      expect(g).toMatchObject({ state: 'writing', attempts: 0, warning: 'could not send the errors to the agent: bridge 503' });
      tasks.promptFailure = undefined;
      for (let i = 0; i < 50 && (await viewOf(id)).state !== 'fixing'; i++) await new Promise((r) => setTimeout(r, 5));
      await generator.settled();
      expect(await viewOf(id)).toMatchObject({ state: 'fixing', attempts: 1 });
      expect((await viewOf(id)).warning).toBeUndefined();
      expect(tasks.prompts).toHaveLength(1);
    });
  });

  describe('questions, last message and cost', () => {
    it('is asking while the agent has an open question, then goes on', async () => {
      const { id, taskId } = await generator.start('Do it');
      const question = { id: 'q1', session: 'main', text: 'Which lanes?', options: ['a', 'b'], asked: '2026-10-21T10:01:00.000Z' };
      tasks.setSession(taskId, 'main', { state: 'waiting', openQuestions: 1 });
      tasks.task(taskId).questions = [{ ...question, id: 'q0', session: 'other' }, question];
      let g = await changed(taskId);
      expect(g).toMatchObject({ state: 'asking', question });
      expect((await generator.list())[0].question).toEqual(question);

      delete tasks.task(taskId).questions;
      tasks.setSession(taskId, 'main', { state: 'running', openQuestions: 0 });
      g = await viewOf((await changed(taskId)).id);
      expect(g.state).toBe('writing');
      expect(g.question).toBeUndefined();
      g = await turnEnds(taskId, VALID);
      expect(g.state).toBe('ready');
      expect(g.id).toBe(id);
    });

    it('a question during a fix shows asking and returns to fixing', async () => {
      const { id, taskId } = await generator.start('Do it');
      await turnEnds(taskId, BAD_STAGE);
      tasks.setSession(taskId, 'main', { state: 'waiting', openQuestions: 1 });
      await changed(taskId);
      expect((await viewOf(id)).state).toBe('asking');
      tasks.setSession(taskId, 'main', { state: 'running', openQuestions: 0 });
      await changed(taskId);
      expect(await viewOf(id)).toMatchObject({ state: 'fixing', attempts: 1 });
    });

    it('keeps the last message and the cost of the task as last seen', async () => {
      const { id, taskId } = await generator.start('Do it');
      tasks.setSession(taskId, 'main', { lastMessage: 'Working on it' });
      tasks.task(taskId).cost = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, usd: { estimate: 0.25 } };
      await changed(taskId);
      expect(await viewOf(id)).toMatchObject({ lastMessage: 'Working on it', cost: { usd: { estimate: 0.25 } } });
      const [summary] = await generator.list();
      expect(summary).toMatchObject({ lastMessage: 'Working on it', cost: { input: 1 }, hasDraft: false });
    });
  });

  describe('the task fails, stops or goes', () => {
    it.each([
      ['failed', 'agent crashed', 'task failed: agent crashed'],
      ['stopped', undefined, 'task was stopped'],
    ] as const)('a %s task fails the generation', async (state, reason, message) => {
      const { id, taskId } = await generator.start('Do it');
      tasks.task(taskId).state = state;
      if (reason) tasks.task(taskId).failureReason = reason;
      await changed(taskId);
      expect(await viewOf(id)).toMatchObject({ state: 'failed', failureReason: message });
    });

    it('a task that is gone fails the generation', async () => {
      const { id, taskId } = await generator.start('Do it');
      tasks.tasks.delete(taskId);
      tasks.emit(taskId);
      await generator.settled();
      expect(await viewOf(id)).toMatchObject({ state: 'failed', failureReason: `task ${taskId} no longer exists` });
    });

    it('a ready generation stays ready when its task stops (the draft is there)', async () => {
      const { id, taskId } = await generator.start('Do it');
      await turnEnds(taskId, VALID);
      tasks.task(taskId).state = 'stopped';
      tasks.emit(taskId);
      await generator.settled();
      expect((await viewOf(id)).state).toBe('ready');
    });
  });

  describe('requestChanges', () => {
    it('only from ready: sends the text with the reminder, back to writing, fixes count from zero', async () => {
      const { id, taskId } = await generator.start('Do it');
      await expect(generator.requestChanges(id, 'More steps')).rejects.toBeInstanceOf(WorkflowConflictError);
      await turnEnds(taskId, BAD_STAGE);
      await turnEnds(taskId, VALID);
      expect((await viewOf(id)).attempts).toBe(1);

      const g = await generator.requestChanges(id, 'Add a review step');
      expect(g).toMatchObject({ state: 'writing', attempts: 0 });
      expect(g.draft).toBeUndefined();
      expect(tasks.prompts.at(-1)).toMatchObject({ taskId, session: 'main' });
      expect(tasks.prompts.at(-1)!.text).toContain('Add a review step');
      expect(tasks.prompts.at(-1)!.text).toMatch(/Rewrite `workflow-draft\.yaml`/);

      // Still idle with the old message right after: not done yet.
      tasks.emit(taskId);
      await generator.settled();
      expect((await viewOf(id)).state).toBe('writing');
      await turnEnds(taskId, BAD_STAGE);
      await turnEnds(taskId, BAD_STAGE);
      expect(await viewOf(id)).toMatchObject({ state: 'fixing', attempts: 2 });
      expect((await turnEnds(taskId, VALID)).state).toBe('ready');
    });

    it('refuses an empty text, and passes a failed prompt on leaving it ready', async () => {
      const { id, taskId } = await generator.start('Do it');
      await turnEnds(taskId, VALID);
      await expect(generator.requestChanges(id, '  ')).rejects.toBeInstanceOf(WorkflowInvalidError);
      tasks.promptFailure = new Error('Task was stopped');
      await expect(generator.requestChanges(id, 'More')).rejects.toThrow('Task was stopped');
      expect((await viewOf(id)).state).toBe('ready');
    });

    it('an unknown generation is not found', async () => {
      await expect(generator.requestChanges('G-20261021-aaaaaaaa', 'x')).rejects.toBeInstanceOf(WorkflowNotFoundError);
      await expect(generator.get('G-20261021-aaaaaaaa')).rejects.toBeInstanceOf(WorkflowNotFoundError);
      await expect(generator.saved('nope')).rejects.toBeInstanceOf(WorkflowNotFoundError);
      await expect(generator.discard('nope')).rejects.toBeInstanceOf(WorkflowNotFoundError);
    });
  });

  describe('saved and discard', () => {
    it('saved: from ready, closes the task, leaves the open list', async () => {
      const { id, taskId } = await generator.start('Do it');
      await expect(generator.saved(id)).rejects.toBeInstanceOf(WorkflowConflictError);
      await turnEnds(taskId, VALID);
      now = new Date('2026-10-21T11:00:00.000Z');
      const g = await generator.saved(id);
      expect(g).toMatchObject({ state: 'saved', finishedAt: '2026-10-21T11:00:00.000Z' });
      expect(tasks.closed).toEqual([taskId]);
      expect(await generator.list()).toEqual([]);
      expect((await viewOf(id)).state).toBe('saved');
      await expect(generator.saved(id)).rejects.toBeInstanceOf(WorkflowConflictError);
      await expect(generator.discard(id)).rejects.toBeInstanceOf(WorkflowConflictError);
      // The closed task's change does not touch it.
      tasks.emit(taskId);
      await generator.settled();
      expect((await viewOf(id)).state).toBe('saved');
    });

    it('saved: also from failed (opened in the editor anyway)', async () => {
      const { id, taskId } = await generator.start('Do it');
      tasks.task(taskId).state = 'failed';
      await changed(taskId);
      expect((await generator.saved(id)).state).toBe('saved');
    });

    it('discard: from any open state, closes the task', async () => {
      const { id, taskId } = await generator.start('Do it');
      tasks.setSession(taskId, 'main', { state: 'running' });
      const g = await generator.discard(id);
      expect(g).toMatchObject({ state: 'discarded', finishedAt: now.toISOString() });
      expect(tasks.closed).toEqual([taskId]);
      expect(await generator.list()).toEqual([]);
    });

    it('a failed close is logged, not fatal; a task that is already gone is fine', async () => {
      const a = await generator.start('Do it');
      tasks.closeFailure = new Error('docker down');
      expect((await generator.discard(a.id)).state).toBe('discarded');
      tasks.closeFailure = undefined;
      const b = await generator.start('Do it again');
      tasks.tasks.delete(b.taskId);
      expect((await generator.discard(b.id)).state).toBe('discarded');
    });
  });

  describe('list and retention', () => {
    it('lists open generations oldest first, without the draft', async () => {
      const a = await generator.start('First');
      now = new Date('2026-10-21T10:05:00.000Z');
      const b = await generator.start('Second');
      await turnEnds(b.taskId, VALID);
      const list = await generator.list();
      expect(list.map((g) => g.id)).toEqual([a.id, b.id]);
      expect(list[1]).toMatchObject({ state: 'ready', hasDraft: true });
      expect(list[1]).not.toHaveProperty('draft');
      expect(list[1]).not.toHaveProperty('turn');
    });

    it('removes saved and discarded generations 7 days after they ended, at list and at startup', async () => {
      const a = await generator.start('A');
      const b = await generator.start('B');
      const c = await generator.start('C');
      await generator.discard(a.id);
      now = new Date(now.getTime() + DAY);
      await generator.discard(b.id);
      now = new Date(now.getTime() + 6 * DAY - 1); // a ended 7 days minus 1 ms ago
      await generator.list();
      expect(readdirSync(dir).sort()).toEqual([a, b, c].map((g) => `${g.id}.json`).sort());

      now = new Date(now.getTime() + 2);
      await generator.list();
      expect(readdirSync(dir).sort()).toEqual([b, c].map((g) => `${g.id}.json`).sort());
      await expect(generator.get(a.id)).rejects.toBeInstanceOf(WorkflowNotFoundError);

      generator.onModuleDestroy();
      now = new Date(now.getTime() + DAY);
      generator = await make();
      expect(readdirSync(dir)).toEqual([`${c.id}.json`]); // open ones stay, however old
    });
  });

  describe('restart', () => {
    it('a new instance over the same folder reconciles open generations and follows their tasks', async () => {
      const a = await generator.start('A');
      const b = await generator.start('B');
      generator.onModuleDestroy();

      // While the app was down: a's turn ended with a valid draft; b's agent asked a question.
      tasks.fileContents.set(DRAFT, VALID);
      tasks.finishTurn(a.taskId, 'main');
      tasks.setSession(b.taskId, 'main', { state: 'waiting', openQuestions: 1 });

      generator = await make();
      await generator.settled();
      expect((await generator.get(a.id)).state).toBe('ready');
      expect((await generator.get(b.id)).state).toBe('asking');

      tasks.fileContents.set(DRAFT, BAD_STAGE);
      tasks.setSession(b.taskId, 'main', { state: 'running', openQuestions: 0 });
      tasks.emit(b.taskId);
      tasks.finishTurn(b.taskId, 'main');
      tasks.emit(b.taskId);
      await generator.settled();
      expect(await generator.get(b.id)).toMatchObject({ state: 'fixing', attempts: 1 });
    });

    it('stops following changes when destroyed', async () => {
      const { id, taskId } = await generator.start('Do it');
      generator.onModuleDestroy();
      tasks.fileContents.set(DRAFT, VALID);
      tasks.finishTurn(taskId, 'main');
      tasks.emit(taskId);
      await generator.settled();
      expect((await generator.get(id)).state).toBe('writing');
    });
  });
});
