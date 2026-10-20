import { expect, test, APIRequestContext, Locator, Page } from '@playwright/test';

// Workflows on the board, against `npm run start:local` with the in-memory backlog and the workflows of e2e/fixtures
// (see playwright.config.ts): the real runner and engine, real bridges, the fake agent.

interface Run { id: string; itemId: string; taskId: string; state: string }

const created: string[] = [];

// A fresh item per test (the app may be a reused one), in the default lane.
async function newItem(request: APIRequestContext, title: string): Promise<string> {
  const res = await request.post('/api/backlog/items', { data: { title: `${title} ${Date.now().toString(36)}` } });
  expect(res.ok()).toBe(true);
  const id = String((await res.json()).id);
  created.push(id);
  return id;
}

test.afterEach(async ({ request }) => {
  const runs = (await (await request.get('/api/workflow-runs')).json()) as Run[];
  for (const run of runs.filter((r) => created.includes(r.itemId))) {
    if (!['done', 'stopped', 'failed'].includes(run.state)) await request.post(`/api/workflow-runs/${run.id}/stop`);
    await request.post(`/api/tasks/${run.taskId}/close`);
    await request.delete(`/api/tasks/${run.taskId}`);
  }
  created.length = 0;
});

const lane = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true });
const card = (page: Page, id: string) => page.getByTestId(`backlog-card-${id}`);
const runLine = (page: Page, id: string) => card(page, id).getByTestId('workflow-run-line');

async function inLane(page: Page, id: string, title: string): Promise<void> {
  await expect(lane(page, title).getByTestId(`backlog-card-${id}`)).toBeVisible({ timeout: 30_000 });
}

async function startWorkflow(page: Page, id: string, workflow: string): Promise<void> {
  await card(page, id).getByRole('button', { name: `Start workflow on #${id}` }).click();
  const picker = page.getByRole('dialog', { name: `Choose a workflow for #${id}` });
  await picker.getByRole('button', { name: workflow }).click();
  const confirm = page.getByRole('dialog', { name: `Start ${workflow} on #${id}?` });
  await confirm.getByRole('button', { name: 'Start' }).click();
  await expect(confirm).toBeHidden();
}

async function awaiting(line: Locator, step: string): Promise<void> {
  await expect(line).toHaveAttribute('data-state', 'awaiting-approval', { timeout: 30_000 });
  await expect(line.getByTestId('workflow-step')).toHaveText(step);
}

test('a workflow carries a card through its steps: start, answer, Continue, forked session, Finish', async ({ page }) => {
  const id = await newItem(page.request, 'Add login');
  await page.goto('/#/backlog');
  await inLane(page, id, 'Backlog');

  await startWorkflow(page, id, 'Plan and review');
  await inLane(page, id, 'Plan');
  const line = runLine(page, id);
  await expect(line).toBeVisible();
  const tasks = (await (await page.request.get('/api/tasks')).json()) as { id: string; title: string }[];
  const task = tasks.find((t) => t.title.startsWith(`#${id} Add login`));
  expect(task).toBeDefined();

  // The fake agent answers; the human gate holds the run.
  await awaiting(line, 'Plan · 1/2');
  await page.screenshot({ path: 'test-results/workflows-awaiting.png', fullPage: true });

  // Open step: the task view with the session and the line back to the board.
  await line.getByRole('link', { name: 'Open step' }).click();
  await expect(page).toHaveURL(new RegExp(`#/tasks/${task!.id}\\?session=main`));
  const view = page.getByRole('article');
  await expect(view.getByText(`echo: Plan #${id}: Add login`).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('task-workflow-line')).toContainText('Workflow Plan and review · step Plan');
  await page.screenshot({ path: 'test-results/workflows-task-view.png', fullPage: true });
  await page.getByRole('link', { name: `#${id} on the board` }).click();
  await expect(page).toHaveURL(new RegExp(`#/backlog\\?item=${id}`));

  // Continue: the exit prompt writes the file step 2 requires, the card moves, the forked session answers.
  await line.getByRole('button', { name: 'Continue → Review' }).click();
  await inLane(page, id, 'Review');
  await awaiting(line, 'Review · 2/2');
  await expect(line.getByTestId('workflow-warning')).toHaveCount(0);
  await line.getByRole('link', { name: 'Open step' }).click();
  await expect(page).toHaveURL(new RegExp(`#/tasks/${task!.id}\\?session=review`));
  // main had two turns (prompt, exit prompt): the fork inherited four messages.
  await expect(page.getByRole('article').getByText('history: 4').first()).toBeVisible({ timeout: 30_000 });
  await page.goBack();

  // Finish: done, the card in the done lane.
  await line.getByRole('button', { name: 'Finish' }).click();
  await inLane(page, id, 'Done');
  await expect(line).toHaveAttribute('data-state', 'done');
  await expect(line.getByRole('button')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/workflows-done.png', fullPage: true });
});

test('a missing required file blocks the step; Start anyway continues', async ({ page }) => {
  const id = await newItem(page.request, 'No plan');
  await page.goto('/#/backlog');
  await startWorkflow(page, id, 'Plan without a file');
  const line = runLine(page, id);
  await awaiting(line, 'Plan · 1/2');

  await line.getByRole('button', { name: 'Continue → Review' }).click();
  await expect(line).toHaveAttribute('data-state', 'blocked', { timeout: 30_000 });
  await expect(line.getByTestId('workflow-warning')).toHaveText(`Missing files: plans/${id}.md`);
  await inLane(page, id, 'Plan');
  await page.screenshot({ path: 'test-results/workflows-blocked.png', fullPage: true });

  await line.getByRole('button', { name: 'Start anyway' }).click();
  await inLane(page, id, 'Review');
  await awaiting(line, 'Review · 2/2');
  await line.getByRole('button', { name: 'Finish' }).click();
  await inLane(page, id, 'Done');
});

test('a card driven by its workflow refuses other drops; a drop on the next step asks to continue', async ({ page }) => {
  const id = await newItem(page.request, 'Drag me');
  await page.goto('/#/backlog');
  await startWorkflow(page, id, 'Plan and review');
  const line = runLine(page, id);
  await awaiting(line, 'Plan · 1/2');

  // Any other lane: refused, the card stays.
  await card(page, id).dragTo(lane(page, 'Done'));
  await expect(page.getByRole('status').filter({ hasText: 'This card is driven by its workflow' })).toBeVisible();
  await page.screenshot({ path: 'test-results/workflows-refused-drag.png', fullPage: true });
  await inLane(page, id, 'Plan');
  await page.getByRole('button', { name: 'Dismiss' }).click();

  // The next step's lane while awaiting approval: asks, then continues the workflow.
  await card(page, id).dragTo(lane(page, 'Review'));
  const dialog = page.getByRole('dialog', { name: 'Continue the workflow to Review?' });
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await inLane(page, id, 'Review');
  await awaiting(line, 'Review · 2/2');

  // Stop workflow asks first; the run line then shows stopped without buttons.
  await line.getByRole('button', { name: 'Stop workflow' }).click();
  await page.getByRole('dialog', { name: `Stop Plan and review on #${id}?` }).getByRole('button', { name: 'Yes, stop' }).click();
  await expect(line).toHaveAttribute('data-state', 'stopped');
  await inLane(page, id, 'Review');
});
