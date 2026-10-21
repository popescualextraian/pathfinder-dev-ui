import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../e2e/create-app';
import { FakeGitlab } from '../helpers/fake-gitlab';
import { describeWithBridge, LocalProcessLauncher, until } from '../helpers/local-process-launcher';

const TOKEN = 'glpat-made-up-workflow-flow-token-4711';

const LANES = `lanes:
  - { id: backlog, title: Backlog, default: true, gitlab: { label: 'status::backlog' } }
  - { id: plan, title: Plan, gitlab: { label: 'status::plan' } }
  - { id: review, title: Review, gitlab: { label: 'status::review' } }
  - { id: done, title: Done, gitlab: { state: closed, label: 'status::done' } }
`;

// Step 1 answers with an echo; its exit prompt makes the fake agent write the file step 2 requires (SHELL: runs in the
// task's worktree). Step 2 is a fork of step 1: the fake agent's HISTORY counts the messages it inherited.
const PLAN_REVIEW = `title: Plan and review
steps:
  - id: plan
    title: Plan
    stage: plan
    prompt: "Plan #{{item.id}}: {{item.title}}"
    gate: human
    exitPrompt: "SHELL:mkdir -p plans && echo plan > plans/{{item.id}}.md"
  - id: review
    title: Review
    stage: review
    requires: ["plans/{{item.id}}.md"]
    fork: plan
    prompt: HISTORY
    gate: human
doneStage: done
`;

// The same without the exit prompt: nobody writes the file, so step 2 is blocked until forced.
const NO_PLAN = PLAN_REVIEW.replace('title: Plan and review', 'title: Plan without a file').replace(/ {4}exitPrompt: .*\n/, '');

interface Run {
  id: string;
  state: string;
  phase: string;
  stepIndex: number;
  taskId: string;
  warning?: string;
  sessions: Record<string, { status: string }>;
}

// The whole run flow through the REST API: real runner, real engine on the local launcher (real agentic-bridge
// processes, fake agent), the backlog against a fake GitLab.
describeWithBridge('workflow run flow against the local launcher and the real bridge', () => {
  let gitlab: FakeGitlab;
  let launcher: LocalProcessLauncher;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());

  const run = async (id: string): Promise<Run> => (await api().get(`/api/workflow-runs/${id}`).expect(200)).body;
  const runIn = (id: string, state: string, timeoutMs = 30_000) =>
    until(`run ${id} ${state}`, async () => {
      const r = await run(id);
      if (['failed', 'stopped'].includes(r.state) && r.state !== state) throw new Error(`run ${r.state}: ${JSON.stringify(r)}`);
      return r.state === state ? r : undefined;
    }, timeoutMs);
  const labels = (itemId: string) => gitlab.issues.get(Number(itemId))?.labels ?? [];
  const issueState = (itemId: string) => gitlab.issues.get(Number(itemId))?.state;
  // The card's lane as the board shows it.
  const lane = async (itemId: string): Promise<string> => (await api().get(`/api/backlog/items/${itemId}`).expect(200)).body.lane;
  // The final agent texts of one session of the task, from its event history.
  const said = async (taskId: string, session: string): Promise<string> =>
    JSON.stringify((await api().get(`/api/tasks/${taskId}/events?session=${session}`).expect(200)).body);

  beforeEach(async () => {
    gitlab = new FakeGitlab(TOKEN);
    await gitlab.start();
    launcher = new LocalProcessLauncher();
    ({ app } = await createApp({
      launcher,
      maxRunning: 4,
      env: { ENGINE_LAUNCHER: 'local', ENGINE_POLL_SECONDS: '1' },
      backlog: { gitlab, lanes: LANES },
      workflows: { 'plan-review.yaml': PLAN_REVIEW, 'no-plan.yaml': NO_PLAN },
    }));
  });

  afterEach(async () => {
    await app?.close();
    await launcher?.dispose();
    await gitlab?.stop();
  });

  it('runs two steps: card follows the steps, exit prompt writes the required file, the second session is a fork, Finish closes the card', async () => {
    const itemId = String(gitlab.addIssue({ title: 'Add login', description: 'Users log in', labels: ['status::backlog'] }));

    const started: Run = (await api().post('/api/workflow-runs').send({ itemId, workflowId: 'plan-review' }).expect(201)).body;
    expect(labels(itemId)).toContain('status::plan');
    expect(await lane(itemId)).toBe('plan');
    const task = (await api().get(`/api/tasks/${started.taskId}`).expect(200)).body;
    expect(task.title).toBe(`#${itemId} Add login`);
    expect(task.prompt).toBe(`Plan #${itemId}: Add login`);

    // The first session answers; the human gate holds the run.
    let r = await runIn(started.id, 'awaiting-approval');
    expect(r).toMatchObject({ stepIndex: 0, phase: 'awaiting-approval', sessions: { main: { status: 'done' }, review: { status: 'pending' } } });
    expect(await said(started.taskId, 'main')).toContain(`echo: Plan #${itemId}: Add login`);

    // Continue: the exit prompt runs first (writes plans/<id>.md), then the card moves and the fork starts.
    r = (await api().post(`/api/workflow-runs/${started.id}/advance`).send({}).expect(200)).body;
    expect(r.phase).toBe('exit');
    r = await until('step 2', async () => {
      const v = await run(started.id);
      return v.stepIndex === 1 ? v : undefined;
    });
    expect(r.sessions.main.status).toBe('done');
    expect(await lane(itemId)).toBe('review');
    expect(await launcher.hasFiles(started.taskId, [`plans/${itemId}.md`])).toEqual({ [`plans/${itemId}.md`]: true });
    const view = (await api().get(`/api/tasks/${started.taskId}`).expect(200)).body;
    expect(view.sessions.map((s: { name: string }) => s.name)).toEqual(['main', 'review']);

    r = await runIn(started.id, 'awaiting-approval');
    expect(r.sessions.review.status).toBe('done');
    expect(r.warning).toBeUndefined();
    // A fork carries main's conversation: two turns (prompt and exit prompt), four messages.
    expect(await said(started.taskId, 'review')).toContain('history: 4');

    // Finish: done, the card in the done lane (closed issue).
    r = (await api().post(`/api/workflow-runs/${started.id}/advance`).send({}).expect(200)).body;
    expect(r.state).toBe('done');
    expect(r.warning).toBeUndefined();
    expect(issueState(itemId)).toBe('closed');
    expect(await lane(itemId)).toBe('done');
    await api().post(`/api/workflow-runs/${started.id}/advance`).send({}).expect(409);
  });

  it('blocks a step whose required file is missing; Start anyway continues', async () => {
    const itemId = String(gitlab.addIssue({ title: 'No plan', labels: ['status::backlog'] }));
    const started: Run = (await api().post('/api/workflow-runs').send({ itemId, workflowId: 'no-plan' }).expect(201)).body;
    await runIn(started.id, 'awaiting-approval');

    let r: Run = (await api().post(`/api/workflow-runs/${started.id}/advance`).send({}).expect(200)).body;
    expect(r).toMatchObject({ state: 'blocked', phase: 'blocked', stepIndex: 0, warning: `Missing files: plans/${itemId}.md` });
    expect(labels(itemId)).toContain('status::plan');

    // Continue without force stays blocked; force starts the step.
    r = (await api().post(`/api/workflow-runs/${started.id}/advance`).send({}).expect(200)).body;
    expect(r.state).toBe('blocked');
    r = (await api().post(`/api/workflow-runs/${started.id}/advance`).send({ force: true }).expect(200)).body;
    expect(r).toMatchObject({ stepIndex: 1, phase: 'sessions' });
    expect(r.warning).toBeUndefined();
    expect(labels(itemId)).toContain('status::review');

    r = await runIn(started.id, 'awaiting-approval');
    expect(r.sessions.review.status).toBe('done');
    expect(await said(started.taskId, 'review')).toContain('history: 2');
    r = (await api().post(`/api/workflow-runs/${started.id}/advance`).send({}).expect(200)).body;
    expect(r.state).toBe('done');
    expect(issueState(itemId)).toBe('closed');
    expect(await lane(itemId)).toBe('done');
  });
});
