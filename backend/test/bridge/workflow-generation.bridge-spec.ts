import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../e2e/create-app';
import { FakeGitlab } from '../helpers/fake-gitlab';
import { describeWithBridge, LocalProcessLauncher, until } from '../helpers/local-process-launcher';

const TOKEN = 'glpat-made-up-workflow-generation-token-4711';

const LANES = `lanes:
  - { id: backlog, title: Backlog, default: true, gitlab: { label: 'status::backlog' } }
  - { id: plan, title: Plan, gitlab: { label: 'status::plan' } }
  - { id: review, title: Review, gitlab: { label: 'status::review' } }
  - { id: done, title: Done, gitlab: { state: closed, label: 'status::done' } }
`;

const draft = (title: string, gate = 'human') => `title: ${title}
steps:
  - id: plan
    title: Plan
    stage: plan
    prompt: "Plan #{{item.id}}: {{item.title}}"
    gate: human
  - id: review
    title: Review
    stage: review
    continue: plan
    prompt: Review the plan
    gate: ${gate}
doneStage: done`;

// The fake agent writes the fenced block after this marker into its worktree (tools/fake-agent/fake-agent.mjs); the
// description reaches it unchanged inside the skill prompt.
const fakeWrite = (yaml: string) => `FAKE_WRITE:workflow-draft.yaml\n\`\`\`yaml\n${yaml}\n\`\`\``;

interface Generation {
  id: string;
  taskId: string;
  state: string;
  attempts: number;
  draft?: { title?: string };
  errors?: { message: string; stepId?: string; field?: string }[];
}

// The generator through the REST API: real WorkflowGenerator, real engine on the local launcher (real agentic-bridge
// processes, fake agent), the draft read from the task's worktree.
describeWithBridge('workflow generation against the local launcher and the real bridge', () => {
  let gitlab: FakeGitlab;
  let launcher: LocalProcessLauncher;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());

  const get = async (id: string): Promise<Generation> => (await api().get(`/api/workflows/generations/${id}`).expect(200)).body;
  const settledIn = (id: string, state: string, timeoutMs = 30_000) =>
    until(`generation ${id} ${state}`, async () => {
      const g = await get(id);
      if (['ready', 'failed'].includes(g.state) && g.state !== state) throw new Error(`generation ${g.state}: ${JSON.stringify(g)}`);
      return g.state === state ? g : undefined;
    }, timeoutMs);
  const said = async (taskId: string): Promise<string> => JSON.stringify((await api().get(`/api/tasks/${taskId}/events`).expect(200)).body);

  beforeEach(async () => {
    gitlab = new FakeGitlab(TOKEN);
    await gitlab.start();
    launcher = new LocalProcessLauncher();
    ({ app } = await createApp({
      launcher,
      maxRunning: 4,
      env: { ENGINE_LAUNCHER: 'local', ENGINE_POLL_SECONDS: '1' },
      backlog: { gitlab, lanes: LANES },
      workflows: {},
    }));
  });

  afterEach(async () => {
    await app?.close();
    await launcher?.dispose();
    await gitlab?.stop();
  });

  it('a valid draft becomes ready; saved closes the task', async () => {
    const started: Generation = (await api().post('/api/workflows/generations')
      .send({ description: `Plan and review.\n${fakeWrite(draft('Generated'))}` }).expect(201)).body;
    expect(started.state).toBe('writing');
    const task = (await api().get(`/api/tasks/${started.taskId}`).expect(200)).body;
    expect(task).toMatchObject({ kind: 'workflow-generator', title: 'Workflow generator: Plan and review.' });

    const g = await settledIn(started.id, 'ready');
    expect(g.attempts).toBe(0);
    expect(g.draft).toMatchObject({ title: 'Generated', steps: [{ id: 'plan' }, { id: 'review', continue: 'plan' }] });
    expect(await launcher.readFile(started.taskId, 'workflow-draft.yaml', 65536)).toContain('title: Generated');

    expect((await api().post(`/api/workflows/generations/${started.id}/saved`).expect(200)).body.state).toBe('saved');
    await until('task closed', async () => (await api().get(`/api/tasks/${started.taskId}`).expect(200)).body.closed === true);
    expect((await api().get('/api/workflows/generations').expect(200)).body).toEqual([]);
  });

  it('an invalid draft fails after two fix prompts with the validator error', async () => {
    const started: Generation = (await api().post('/api/workflows/generations')
      .send({ description: `Unknown gate.\n${fakeWrite(draft('Broken', 'manual'))}` }).expect(201)).body;

    const g = await settledIn(started.id, 'failed', 40_000);
    expect(g.attempts).toBe(2);
    expect(g.errors).toEqual([expect.objectContaining({ stepId: 'review', field: 'gate', message: expect.stringContaining('"human" or "auto"') })]);
    expect(g.draft).toMatchObject({ title: 'Broken' });
    const events = await said(started.taskId);
    expect(events).toContain('this is fix 1 of 2');
    expect(events).toContain('this is fix 2 of 2');

    expect((await api().post(`/api/workflows/generations/${started.id}/discard`).expect(200)).body.state).toBe('discarded');
    await until('task closed', async () => (await api().get(`/api/tasks/${started.taskId}`).expect(200)).body.closed === true);
  });
});
