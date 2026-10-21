import { expect, test, APIRequestContext, Locator, Page } from '@playwright/test';

// Generating a workflow with AI on the Workflows page, against `npm run start:local` (see playwright.config.ts): the
// real generator and engine, real bridges, the fake agent. The description is embedded unchanged in the skill prompt,
// so the fake agent finds its markers there: `FAKE_WRITE:workflow-draft.yaml` plus a fenced block writes the draft,
// a line `ASK:<question>` asks the human (tools/fake-agent/fake-agent.mjs).

interface Generation { id: string; taskId: string; state: string }

const suffix = Date.now().toString(36);
const generations: string[] = [];
const workflows: string[] = [];

/** A workflow in the 015 format, valid for the lanes of e2e/fixtures/backlog.yaml (gate replaceable). */
function draft(title: string, reviewGate = 'human'): string {
  return [
    `title: ${title}`,
    'steps:',
    '  - id: plan',
    '    title: Plan',
    '    stage: plan',
    '    prompt: "Plan #{{item.id}}: {{item.title}}"',
    '    gate: human',
    '  - id: review',
    '    title: Review',
    '    stage: review',
    '    continue: plan',
    '    prompt: Review the plan',
    `    gate: ${reviewGate}`,
    'doneStage: done',
  ].join('\n');
}

const fakeWrite = (yaml: string) => ['FAKE_WRITE:workflow-draft.yaml', '```yaml', yaml, '```'].join('\n');

test.afterEach(async ({ request }) => {
  for (const id of generations) {
    const res = await request.get(`/api/workflows/generations/${id}`);
    if (!res.ok()) continue;
    const g = (await res.json()) as Generation;
    if (!['saved', 'discarded'].includes(g.state)) await request.post(`/api/workflows/generations/${id}/discard`);
    await request.post(`/api/tasks/${g.taskId}/close`);
    await request.delete(`/api/tasks/${g.taskId}`);
  }
  generations.length = 0;
  for (const id of workflows) {
    const stored = await request.get(`/api/workflows/${id}`);
    if (!stored.ok()) continue;
    const { version } = (await stored.json()) as { version: string };
    await request.delete(`/api/workflows/${id}?version=${version}`);
  }
  workflows.length = 0;
});

async function openWorkflows(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Workflows', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generate with AI' })).toBeVisible();
}

/** Starts a generation through the dialog; returns its panel and id (registered for cleanup). */
async function generate(page: Page, description: string): Promise<{ panel: Locator; id: string }> {
  await page.getByRole('button', { name: 'Generate with AI' }).click();
  const dialog = page.getByRole('dialog', { name: 'Generate a workflow with AI' });
  await dialog.getByLabel('Describe the workflow').fill(description);
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 }); // the task starts first (worktree, bridge)
  // The first line (unique per test) is the start of the shortened description.
  const firstLine = description.split('\n')[0];
  const panel = page.getByRole('region', { name: 'Generations' }).getByRole('article').filter({ hasText: firstLine });
  await expect(panel).toHaveCount(1);
  const id = ((await panel.getAttribute('data-testid')) ?? '').replace(/^generation-/, '');
  expect(id).toMatch(/^G-\d{8}-[a-z0-9]+$/);
  generations.push(id);
  return { panel, id };
}

const stateOf = (panel: Locator) => panel.getByTestId('generation-state');

async function generation(request: APIRequestContext, id: string): Promise<Generation> {
  const res = await request.get(`/api/workflows/generations/${id}`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as Generation;
}

test('a valid draft: ready, opened in the editor, saved; the generation is gone and its task closed', async ({ page, request }) => {
  const title = `Generated ${suffix}`;
  const workflowId = `generated-${suffix}`;
  workflows.push(workflowId);
  await openWorkflows(page);
  const { panel, id } = await generate(page, [`Valid ${suffix}: plan, then review.`, fakeWrite(draft(title))].join('\n'));

  await expect(stateOf(panel)).toHaveText('draft ready', { timeout: 30_000 });
  await expect(panel.getByRole('link', { name: 'open task' })).toBeVisible();
  await panel.getByRole('link', { name: 'Open in editor' }).click();

  // The draft opens as a new, unsaved workflow; its id is proposed from the title.
  await expect(page.getByLabel('Workflow title')).toHaveValue(title);
  await expect(page.getByLabel('Workflow id')).toHaveValue(workflowId);
  await expect(page.getByTestId('step-box-1')).toContainText('Plan');
  await expect(page.getByTestId('step-box-2')).toContainText('Review');
  await page.screenshot({ path: 'test-results/workflow-generation-editor.png', fullPage: true });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Workflow id')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(page.getByTestId('editor-notice')).toHaveCount(0);

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId(`workflow-row-${workflowId}`)).toContainText(title);
  await expect(page.getByTestId(`generation-${id}`)).toHaveCount(0);
  const saved = await generation(request, id);
  expect(saved.state).toBe('saved');
  // The task is closed after the generation is stored as saved.
  await expect.poll(async () => (await (await request.get(`/api/tasks/${saved.taskId}`)).json()), { timeout: 15_000 })
    .toMatchObject({ closed: true, kind: 'workflow-generator' });
});

test('an invalid draft: fixed twice without success, then failed with the error; discard', async ({ page, request }) => {
  await openWorkflows(page);
  const { panel, id } = await generate(page, [`Invalid ${suffix}: an unknown gate.`, fakeWrite(draft(`Broken ${suffix}`, 'manual'))].join('\n'));

  // The fake agent does not rewrite the file on a fix prompt, so both fixes fail.
  await expect(stateOf(panel)).toHaveText('failed', { timeout: 60_000 });
  await expect(panel.getByRole('list', { name: 'Errors' })).toContainText('review · gate: steps[1].gate must be "human" or "auto"');
  await expect(panel.getByRole('link', { name: 'Open in editor anyway' })).toBeVisible();
  expect(await generation(request, id)).toMatchObject({ state: 'failed', attempts: 2 });
  const fixes = JSON.stringify(await (await request.get(`/api/tasks/${(await generation(request, id)).taskId}/events`)).json());
  expect(fixes).toContain('this is fix 1 of 2');
  expect(fixes).toContain('this is fix 2 of 2');

  await panel.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByTestId(`generation-${id}`)).toHaveCount(0);
  expect((await generation(request, id)).state).toBe('discarded');
});

test('a question: asked in the panel, answered there, then the draft is ready; changes requested; discard', async ({ page, request }) => {
  await openWorkflows(page);
  const question = `Should a human approve the review (${suffix})?`;
  // The draft is written in the first turn, which then asks; after the answer the turn ends and the check runs.
  const { panel, id } = await generate(page, [`Ask ${suffix}: plan and review.`, `ASK:${question}`, fakeWrite(draft(`Asked ${suffix}`))].join('\n'));

  await expect(stateOf(panel)).toHaveText('asking', { timeout: 30_000 });
  await expect(panel.getByTestId('generation-question')).toContainText(question);
  await panel.getByLabel('Answer').fill('Yes, a human approves it.');
  await panel.getByRole('button', { name: 'Send answer' }).click();
  await expect(stateOf(panel)).toHaveText('draft ready', { timeout: 30_000 });
  await expect(panel.getByTestId('generation-question')).toHaveCount(0);
  expect(JSON.stringify(await (await request.get(`/api/workflows/generations/${id}`)).json())).toContain(`Asked ${suffix}`);

  // Request changes: the text reaches the agent unchanged, so its FAKE_WRITE rewrites the draft.
  await panel.getByLabel('Changes').fill([`Rename it.`, fakeWrite(draft(`Changed ${suffix}`))].join('\n'));
  await panel.getByRole('button', { name: 'Request changes' }).click();
  await expect.poll(async () => JSON.stringify(await (await request.get(`/api/workflows/generations/${id}`)).json()), { timeout: 30_000 })
    .toContain(`"title":"Changed ${suffix}"`);
  await expect(stateOf(panel)).toHaveText('draft ready', { timeout: 30_000 });

  await panel.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByTestId(`generation-${id}`)).toHaveCount(0);
  const g = await generation(request, id);
  expect(g.state).toBe('discarded');
  await expect.poll(async () => (await (await request.get(`/api/tasks/${g.taskId}`)).json()).closed, { timeout: 15_000 }).toBe(true);
});
