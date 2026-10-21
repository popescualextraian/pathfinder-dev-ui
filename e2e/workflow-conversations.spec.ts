import { expect, test } from '@playwright/test';

// A workflow with a continuing step and a forked step, built in the editor without typing any id, then run on a
// card with the real runner and the fake agent (see playwright.config.ts).

interface Run { id: string; itemId: string; taskId: string; state: string }

const suffix = Date.now().toString(36);
const title = `Conversations ${suffix}`;
const id = `conversations-${suffix}`;
let itemId: string | undefined;

test.afterEach(async ({ request }) => {
  const runs = (await (await request.get('/api/workflow-runs')).json()) as Run[];
  for (const run of runs.filter((r) => r.itemId === itemId)) {
    if (!['done', 'stopped', 'failed'].includes(run.state)) await request.post(`/api/workflow-runs/${run.id}/stop`);
    await request.post(`/api/tasks/${run.taskId}/close`);
    await request.delete(`/api/tasks/${run.taskId}`);
  }
  const stored = await request.get(`/api/workflows/${id}`);
  if (stored.ok()) {
    const { version } = (await stored.json()) as { version: string };
    await request.delete(`/api/workflows/${id}?version=${version}`);
  }
});

test('a workflow with a continue step and a fork step, made in the editor, runs through', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Workflows' }).click();
  await page.getByRole('button', { name: 'New workflow' }).click();
  await page.getByLabel('Workflow title').fill(title);
  await expect(page.getByLabel('Workflow id')).toHaveValue(id);

  // Step 1: a new conversation (the first step has no choice).
  await page.getByLabel('Step title').fill('Draft');
  await expect(page.getByLabel('Conversation')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Draft #{{item.id}}');

  // Step 2: continues Draft in the same conversation, goes on by itself.
  await page.getByRole('button', { name: '+ step' }).click();
  await page.getByLabel('Step title').fill('Refine');
  await page.getByLabel('Conversation').selectOption({ label: 'Continue: Draft' });
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Refine #{{item.id}}');
  await page.getByLabel('Then').selectOption('auto');
  await expect(page.getByTestId('step-box-2')).toContainText('continues Draft');

  // Step 3: a copy of Refine's conversation (which is Draft's); the fake agent reports how much it inherited.
  await page.getByRole('button', { name: '+ step' }).click();
  await page.getByLabel('Step title').fill('Check');
  await page.getByLabel('Conversation').selectOption({ label: 'Copy of: Refine' });
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('HISTORY');
  await expect(page.getByTestId('step-box-3')).toContainText('copy of Refine');

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId(`workflow-row-${id}`)).toContainText('Draft → Refine → Check');

  // The saved file has generated ids and no session names.
  const saved = (await (await page.request.get(`/api/workflows/${id}`)).json()).definition;
  expect(saved.steps.map((s: { id: string }) => s.id)).toEqual(['draft', 'refine', 'check']);
  expect(saved.steps[1].continue).toBe('draft');
  expect(saved.steps[2].fork).toBe('refine');

  const res = await page.request.post('/api/backlog/items', { data: { title: `Conversation item ${suffix}` } });
  itemId = String((await res.json()).id);
  await page.goto('/#/backlog');
  const card = page.getByTestId(`backlog-card-${itemId}`);
  await card.getByRole('button', { name: `Start workflow on #${itemId}` }).click();
  await page.getByRole('dialog', { name: `Choose a workflow for #${itemId}` }).getByRole('button', { name: title }).click();
  await page.getByRole('dialog', { name: `Start ${title} on #${itemId}?` }).getByRole('button', { name: 'Start' }).click();

  const line = card.getByTestId('workflow-run-line');
  await expect(line).toHaveAttribute('data-state', 'awaiting-approval', { timeout: 30_000 });
  await expect(line.getByTestId('workflow-step')).toHaveText('Draft · 1/3');
  await line.getByRole('button', { name: 'Continue → Refine' }).click();
  // Refine is automatic: the run goes on to Check, the forked step, and waits there.
  await expect(line.getByTestId('workflow-step')).toHaveText('Check · 3/3', { timeout: 30_000 });
  await expect(line).toHaveAttribute('data-state', 'awaiting-approval', { timeout: 30_000 });

  await line.getByRole('link', { name: 'Open step' }).click();
  // main had two turns (Draft, Refine): the fork inherited four messages.
  await expect(page.getByRole('article').getByText('history: 4').first()).toBeVisible({ timeout: 30_000 });
  await page.goBack();
  await line.getByRole('button', { name: 'Finish' }).click();
  await expect(line).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
});
